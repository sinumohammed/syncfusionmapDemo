import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from "@angular/core";
import { forkJoin, of } from "rxjs";
import { NxDonutConfigService } from "./services/nx-donut-config.service";
import { DonutCollectionConfig, DonutConfig, DonutSelectionEvent } from "./model/nx-donut-model";

// Iterates NxDonutComponent — one <app-nx-donut> per entry in `config.donuts`,
// purely off that array's length/content, not a fixed count. Each entry is
// its own DonutDataSource<DonutConfig>: inline data, or fetched
// independently from a file/API, same as nx-map lets each layer resolve its
// own config independently (see NxDonutConfigService, deliberately NOT
// shared with nx-map's own equivalent service).
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
  // No bundled default (same reasoning as NxMapDemoComponent.parentConfig)
  // — the host supplies its own collection config, e.g. AppComponent
  // binding config/nx-donut-charts.json.
  @Input() config?: DonutCollectionConfig;

  @Output() sublayersSelected = new EventEmitter<DonutSelectionEvent>();

  donuts: DonutConfig[] = [];
  legendItems: { label: string; color: string }[] = [];
  selectedId: string | null = null;

  constructor(private configService: NxDonutConfigService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes.config) {
      return;
    }
    const sources = this.config?.donuts ?? [];
    const resolved$ = sources.length ? forkJoin(sources.map(s => this.configService.resolve(s))) : of([]);
    resolved$.subscribe(donuts => {
      this.donuts = donuts;
      this.selectedId = null;
      // Legend is derived from the first donut's own slice labels/colors —
      // every donut in a collection is expected to share the same
      // category scheme (e.g. "Customer impact"/"Non-customer impact"),
      // same as the demo config does; a collection mixing incompatible
      // schemes just gets the first donut's legend, no worse than showing
      // seven different ones stacked on top of each other.
      this.legendItems = (donuts[0]?.data ?? []).map((d, i) => ({
        label: d.x,
        color: d.color ?? DEFAULT_LEGEND_PALETTE[i % DEFAULT_LEGEND_PALETTE.length]
      }));
    });
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
