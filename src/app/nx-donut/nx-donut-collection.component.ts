import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from "@angular/core";
import { buildDonutConfigs } from "./services/parent-donut-config-transform";
import { DonutConfig, DonutSelectionEvent, RawDonutCollectionNode, TrendGroup } from "./model/nx-donut-model";

// Iterates NxDonutComponent — one <app-nx-donut> per donut buildDonutConfigs()
// resolves from the two inputs below, purely off its own returned length,
// not a fixed count.
//
// Deliberately two SEPARATE inputs, not one pre-merged config: `rawConfig`
// (the upstream widget payload — which donuts exist, their names/ordering)
// and `trendResponse` (the live values to fill them with) come from
// different places on a real host and change on different schedules — the
// widget config rarely changes, the trend data does, often on its own
// refresh timer. ngOnChanges() below re-runs buildDonutConfigs() whenever
// EITHER changes, so a host can push a fresh trendResponse on its own
// interval without touching rawConfig at all, or vice versa.
//
// Owns the one thing that only makes sense collection-wide: which donut is
// currently selected, and turning a click into a DonutSelectionEvent (the
// clicked donut's own sub-layer id(s), plus every donut's id(s) in this
// collection — see DonutSelectionEvent's own comment). NxDonutComponent
// itself has no idea any of this exists.
@Component({
  selector: "app-nx-donut-collection",
  templateUrl: "./nx-donut-collection.component.html",
  styleUrls: ["./nx-donut-collection.component.scss"]
})
export class NxDonutCollectionComponent implements OnChanges {
  // The upstream widget payload's own collection node (ComponentType 7121,
  // COMPONENT_NXCIRCULAR_COLLECTION) — see parent-donut-config-transform.ts
  // for the exact shape this reads. No bundled default (same reasoning as
  // NxMapDemoComponent.parentConfig) — the host supplies its own.
  @Input() rawConfig?: RawDonutCollectionNode;

  // The trend API's own response, matched against rawConfig's own
  // Configuration[] entries by name — see buildDonutConfigs()'s own comment
  // for the exact join rules. Undefined/omitted renders every donut with no
  // data (the existing empty-ring state), same as a rawConfig with no
  // matching trend at all.
  @Input() trendResponse?: TrendGroup[];

  @Output() sublayersSelected = new EventEmitter<DonutSelectionEvent>();

  donuts: DonutConfig[] = [];
  legendItems: { label: string; color: string }[] = [];
  selectedId: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes.rawConfig && !changes.trendResponse) {
      return;
    }
    console.log('sino')
    this.donuts = this.rawConfig ? buildDonutConfigs(this.rawConfig, this.trendResponse ?? []) : [];
    this.selectedId = null;
    // Legend is derived from the first donut's own slice labels/colors —
    // every donut in a collection is expected to share the same category
    // scheme (e.g. "Customer impact"/"Non-customer impact"), same as the
    // demo config does; a collection mixing incompatible schemes just gets
    // the first donut's legend, no worse than showing seven different ones
    // stacked on top of each other.
    this.legendItems = (this.donuts[0]?.data ?? []).map((d, i) => ({
      label: d.x,
      color: d.color ?? DEFAULT_LEGEND_PALETTE[i % DEFAULT_LEGEND_PALETTE.length]
    }));
  }

  onDonutSelected(donut: DonutConfig): void {
    const alreadySelected = this.selectedId === donut.id;
    this.selectedId = alreadySelected ? null : donut.id;

    const allIds = this.donuts.flatMap(d => d.sublayerIds ?? [d.id]);

    this.sublayersSelected.emit({
      selectedId: alreadySelected ? null : donut.sublayerIds?.[0] ?? donut.id,
      allIds,
      slices: alreadySelected ? undefined : donut.data
    });
  }
}

// Matches NxDonutComponent's own DEFAULT_PALETTE — kept in sync manually
// since NxDonutComponent doesn't export it (this component only needs it
// for the legend swatches, not for driving the chart itself).
const DEFAULT_LEGEND_PALETTE = ["#1f4e79", "#e07b39", "#3fae5a", "#c94a3f", "#8e5ea2", "#3fbfbf"];
