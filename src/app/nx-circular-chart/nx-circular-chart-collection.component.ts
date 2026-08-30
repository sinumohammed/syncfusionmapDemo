import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from "@angular/core";
import { buildCircularChartConfigs } from "./services/parent-circular-chart-config-transform";
import { NxCircularChartConfigService } from "./services/nx-circular-chart-config.service";
import { CircularChartConfig, CircularChartSelectionEvent, DEFAULT_PALETTE, RawCircularChartCollectionNode, TrendGroup } from "./model/nx-circular-chart-model";

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
// interval without touching rawConfig at all, or vice versa. EXCEPTION:
// when rawConfig.ApiUrl is set, this component fetches its own trend
// response from that URL instead and uses THAT, neglecting the
// `trendResponse` @Input entirely — see ngOnChanges()'s own comment.
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
  // matching trend at all. IGNORED whenever rawConfig.ApiUrl is set (see
  // ngOnChanges()) — that mode fetches its own trend response instead.
  @Input() trendResponse?: TrendGroup[];

  @Output() sublayersSelected = new EventEmitter<CircularChartSelectionEvent>();

  circularCharts: CircularChartConfig[] = [];
  legendItems: { label: string; color: string }[] = [];
  selectedId: string | null = null;

  // Bumped on every fetchTrendFromApi() call and captured per in-flight
  // request so a stale response from a superseded rawConfig can't overwrite
  // a newer one that resolved first.
  private requestToken = 0;

  constructor(private configService: NxCircularChartConfigService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes.rawConfig && !changes.trendResponse) {
      return;
    }
    // rawConfig.ApiUrl set — this component fetches the trend response
    // itself and uses THAT, neglecting the `trendResponse` @Input entirely
    // (per product decision: an ApiUrl on the config always wins). Only
    // (re)fetches when rawConfig ITSELF changed, not on a trendResponse-only
    // change — that value is ignored in this mode anyway, and ApiUrl is the
    // same URL every time, so there's nothing new to fetch.
    if (this.rawConfig?.ApiUrl) {
      if (changes.rawConfig) {
        this.fetchTrendFromApi(this.rawConfig.ApiUrl);
      }
      return;
    }
    this.applyConfigs(this.trendResponse ?? []);
  }

  private fetchTrendFromApi(url: string): void {
    const token = ++this.requestToken;
    this.configService.fetchTrendResponse(url).subscribe({
      next: response => {
        if (token === this.requestToken) {
          this.applyConfigs(response ?? []);
        }
      },
      error: () => {
        if (token === this.requestToken) {
          console.error(`[NxCircularChartCollection] ApiUrl "${url}" failed to load — rendering with no trend data.`);
          this.applyConfigs([]);
        }
      }
    });
  }

  private applyConfigs(trendResponse: TrendGroup[]): void {
    this.circularCharts = this.rawConfig ? buildCircularChartConfigs(this.rawConfig, trendResponse) : [];
    this.selectedId = null;
    // Legend is derived from the UNION of every circular chart's own slice
    // labels/colors, not just the first chart's — different charts in the
    // same collection can each carry their own subset of categories (e.g.
    // DISSOLVED adding an "Other impact" slice no other chart has), and all
    // of them still need to show up in the one shared legend. Dedup by
    // label, keeping the color/position from wherever that label was first
    // seen (ordered by circularCharts order, then by that chart's own slice
    // order).
    const seen = new Map<string, string>();
    this.circularCharts.forEach(chart =>
      (chart.data ?? []).forEach((d, i) => {
        if (!seen.has(d.x)) {
          seen.set(d.x, d.color ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]);
        }
      })
    );
    this.legendItems = Array.from(seen, ([label, color]) => ({ label, color }));
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
