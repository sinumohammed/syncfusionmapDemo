import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from "@angular/core";
import { buildCircularChartConfigs, visibleCircularChartCount } from "./services/parent-circular-chart-config-transform";
import { NxCircularChartConfigService } from "./services/nx-circular-chart-config.service";
import { CircularChartConfig, CircularChartSelectionEvent, DEFAULT_PALETTE, RawCircularChartCollectionNode, TrendNode } from "./model/nx-circular-chart-model";

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
  // matching trend at all. IGNORED whenever rawConfig.ApiUrl is set (see
  // ngOnChanges()) — that mode fetches its own trend response instead.
  @Input() trendResponse?: TrendNode[];

  @Output() sublayersSelected = new EventEmitter<CircularChartSelectionEvent>();

  circularCharts: CircularChartConfig[] = [];
  legendItems: { label: string; color: string }[] = [];
  selectedId: string | null = null;
  // Set only when rawConfig.ApiUrl's own fetch errors — distinct from
  // circularCharts just coming back empty (a real "no data yet" response),
  // see the template's own comment for the two different messages this
  // drives.
  fetchFailed = false;

  // True only while an ApiUrl fetch is actually in flight — the
  // trendResponse @Input path is synchronous (no network round trip), so
  // this never applies there. Drives the template's loader in place of the
  // "No data available." message, which otherwise flashes on every ApiUrl
  // fetch (rawConfig set, response not back yet) even though real data is
  // on its way — same "don't show empty for a genuinely still-loading
  // state" rule fetchFailed follows for a genuinely failed one.
  loading = false;

  // How many skeleton placeholder cards to render while `loading` is true —
  // one entry per index, just so *ngFor has something to iterate (the
  // template never reads the value itself). Derived from rawConfig (see
  // visibleCircularChartCount()'s own comment) once per ngOnChanges rather
  // than as a getter re-run on every change-detection pass.
  skeletonItems: number[] = [];

  // Bumped on every ngOnChanges run and captured per in-flight ApiUrl fetch
  // so a stale response from a superseded rawConfig can't overwrite a
  // newer one that resolved first.
  private requestToken = 0;

  constructor(private configService: NxCircularChartConfigService, private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes.rawConfig && !changes.trendResponse) {
      return;
    }
    const token = ++this.requestToken;
    this.fetchFailed = false;
    // rawConfig.ApiUrl set — this component fetches the trend response
    // itself and uses THAT, neglecting the `trendResponse` @Input entirely
    // (per product decision: an ApiUrl on the config always wins).
    if (this.rawConfig?.ApiUrl) {
      this.loading = true;
      this.skeletonItems = Array.from({ length: visibleCircularChartCount(this.rawConfig) }, (_, i) => i);
      this.configService.fetchTrendResponse(this.rawConfig.ApiUrl).subscribe({
        next: response => {
          if (token === this.requestToken) {
            this.loading = false;
            this.applyConfigs(response ?? [], false);
          }
        },
        error: () => {
          if (token === this.requestToken) {
            console.error(`[NxCircularChartCollection] ApiUrl "${this.rawConfig?.ApiUrl}" failed to load — rendering with no trend data.`);
            this.loading = false;
            this.fetchFailed = true;
            this.applyConfigs([], false);
          }
        }
      });
      return;
    }
    this.loading = false;
    // No ApiUrl — when the host also hasn't supplied a (non-empty)
    // trendResponse @Input, there's no live trend source at all, so fall
    // back to each Configuration[] entry's own hardcoded Data (see
    // buildCircularChartConfigs()'s own comment for why that needs an
    // explicit flag rather than just an empty trendResponse). A host that
    // DOES push its own trendResponse keeps the existing API-response
    // behavior — matched-only, dropping unmatched configured items.
    const hasTrendResponse = !!this.trendResponse && this.trendResponse.length > 0;
    this.applyConfigs(this.trendResponse ?? [], !hasTrendResponse);
  }

  private applyConfigs(trendResponse: TrendNode[], useConfigFallback: boolean): void {
    this.circularCharts = this.rawConfig ? buildCircularChartConfigs(this.rawConfig, trendResponse, useConfigFallback) : [];
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
    // ApiUrl mode reaches this callback from an RxJS `subscribe()` — a
    // DIFFERENT change-detection cycle than the one Angular already runs
    // for a synchronous ngOnChanges (the trendResponse-only, non-ApiUrl
    // path above). Confirmed live: without this, circularCharts/legendItems
    // update correctly but NxCircularChartComponent's own *ngIf-gated views
    // (its chart/empty-ring) stay stuck on their pre-fetch state even
    // though its class bindings (e.g. isEmpty) DO update — a structural-
    // directive desync specific to the async path. Forcing a check here,
    // right after the data that feeds those child *ngFor'd components
    // changes, closes that gap.
    this.cdr.detectChanges();
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
