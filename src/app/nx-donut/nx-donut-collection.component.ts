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
  template: `
    <div class="nx-donut-panel">
      <div class="nx-donut-grid">
        <app-nx-donut
          *ngFor="let donut of donuts"
          [config]="donut"
          [selected]="selectedId === donut.id"
          (select)="onDonutSelected(donut)"
        ></app-nx-donut>
      </div>

      <div class="nx-donut-legend" *ngIf="legendItems.length">
        <div class="nx-donut-legend-item" *ngFor="let item of legendItems">
          <span class="nx-donut-swatch" [style.background]="item.color"></span>
          {{ item.label }}
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        width: 100%;
      }
      .nx-donut-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        box-sizing: border-box;
        padding: 12px;
        /* No overflow-y here on purpose — an ancestor with any non-visible
           overflow clips a hovered slice's tooltip too (CSS forces both
           axes non-visible together once either one is), confirmed live
           that was cutting the tooltip's text off. */
      }
      .nx-donut-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }
      .nx-donut-legend {
        margin-top: 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 12px;
        color: #333;
      }
      .nx-donut-legend-item {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .nx-donut-swatch {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 2px;
      }
    `
  ]
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
