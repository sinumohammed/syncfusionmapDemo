import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from "@angular/core";
import { buildCircularChartConfigs } from "./services/parent-circular-chart-config-transform";
import { CircularChartConfig, CircularChartSelectionEvent, RawCircularChartCollectionNode, TrendGroup } from "./model/nx-circular-chart-model";

// Iterates NxCircularChartComponent — one <app-nx-circular-chart> per circular chart buildCircularChartConfigs()
// resolves from the two inputs below, purely off its own returned length,
// not a fixed count.
//
// Deliberately two SEPARATE inputs, not one pre-merged config: `rawConfig`
// (the upstream widget payload — which circularCharts exist, their names/ordering)
// and `trendResponse` (the live values to fill them with) come from
// different places on a real host and change on different schedules — the
// widget config rarely changes, the trend data does, often on its own
// refresh timer. ngOnChanges() below re-runs buildCircularChartConfigs() whenever
// EITHER changes, so a host can push a fresh trendResponse on its own
// interval without touching rawConfig at all, or vice versa.
//
// Owns the one thing that only makes sense collection-wide: which circular chart is
// currently selected, and turning a click into a CircularChartSelectionEvent (the
// clicked circular chart's own sub-layer id(s), plus every circular chart's id(s) in this
// collection — see CircularChartSelectionEvent's own comment). NxCircularChartComponent
// itself has no idea any of this exists.
@Component({
  selector: "app-nx-circular-chart-collection",
  templateUrl: "./nx-circular-chart-collection.component.html",
  styleUrls: ["./nx-circular-chart-collection.component.scss"]
})
export class NxCircularChartCollectionComponent implements OnChanges {
  // The upstream widget payload's own collection node (ComponentType 7121,
  // COMPONENT_NXCIRCULAR_COLLECTION) — see parent-circular-chart-config-transform.ts
  // for the exact shape this reads. No bundled default (same reasoning as
  // NxMapDemoComponent.parentConfig) — the host supplies its own.
  @Input() rawConfig?: RawCircularChartCollectionNode;

  // The trend API's own response, matched against rawConfig's own
  // Configuration[] entries by name — see buildCircularChartConfigs()'s own comment
  // for the exact join rules. Undefined/omitted renders every circular chart with no
  // data (the existing empty-ring state), same as a rawConfig with no
  // matching trend at all.
  @Input() trendResponse?: TrendGroup[];

  @Output() sublayersSelected = new EventEmitter<CircularChartSelectionEvent>();

  circularCharts: CircularChartConfig[] = [];
  legendItems: { label: string; color: string }[] = [];
  selectedId: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes.rawConfig && !changes.trendResponse) {
      return;
    }
    console.log('sino')
    this.circularCharts = this.rawConfig ? buildCircularChartConfigs(this.rawConfig, this.trendResponse ?? []) : [];
    this.selectedId = null;
    // Legend is derived from the first circular chart's own slice labels/colors —
    // every circular chart in a collection is expected to share the same category
    // scheme (e.g. "Customer impact"/"Non-customer impact"), same as the
    // demo config does; a collection mixing incompatible schemes just gets
    // the first circular chart's legend, no worse than showing seven different ones
    // stacked on top of each other.
    this.legendItems = (this.circularCharts[0]?.data ?? []).map((d, i) => ({
      label: d.x,
      color: d.color ?? DEFAULT_LEGEND_PALETTE[i % DEFAULT_LEGEND_PALETTE.length]
    }));
  }

  onCircularChartSelected(circularChart: CircularChartConfig): void {
    const alreadySelected = this.selectedId === circularChart.id;
    this.selectedId = alreadySelected ? null : circularChart.id;

    const allIds = this.circularCharts.flatMap(d => d.sublayerIds ?? [d.id]);

    this.sublayersSelected.emit({
      selectedId: alreadySelected ? null : circularChart.sublayerIds?.[0] ?? circularChart.id,
      allIds,
      slices: alreadySelected ? undefined : circularChart.data
    });
  }
}

// Matches NxCircularChartComponent's own DEFAULT_PALETTE — kept in sync manually
// since NxCircularChartComponent doesn't export it (this component only needs it
// for the legend swatches, not for driving the chart itself).
const DEFAULT_LEGEND_PALETTE = ["#1f4e79", "#e07b39", "#3fae5a", "#c94a3f", "#8e5ea2", "#3fbfbf"];
