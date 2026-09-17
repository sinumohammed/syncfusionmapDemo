import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from "@angular/core";
import { buildCircularChartConfigs, visibleCircularChartCount } from "./services/parent-circular-chart-config-transform";
import { NxCircularChartConfigService } from "./services/nx-circular-chart-config.service";
import {
  CircularChartConfig,
  CircularChartSelectionEvent,
  DEFAULT_SERIES_PALETTE,
  parseSeriesPalette,
  RawCircularChartCollectionNode,
  SeriesPaletteEntry,
  SeriesPaletteShape,
  TrendNode
} from "./model/nx-circular-chart-model";

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

  // Grid column count — the template binds this straight onto
  // .nx-circular-chart-grid's own grid-template-columns (see the template
  // and nx-circular-chart-collection.component.scss's own comment on why
  // the SCSS rule itself no longer hardcodes a column count). No default —
  // unlike rows (0 has its own meaning: unlimited/no carousel), any
  // fallback here would be an arbitrary fixed number baked into this
  // component instead of left to the host, which is exactly what
  // MapDashboardComponent's own circularChartColumns (config-driven, with
  // its own auto/square-layout fallback when config leaves it unset) and
  // TrendDashboardComponent's own hardcoded [columns]="6" both already do
  // at the call site. The component picking a count from its own
  // circularCharts.length instead isn't viable either — that count stays
  // stable across a loading/empty transition, matching skeletonItems (the
  // loading placeholder grid), which has no reliable final count to key
  // off yet.
  @Input() columns!: number;

  // Rows per COLUMN of the sliding carousel below (not a total row count
  // across every circular chart) — paired with `columns` (how many of
  // those columns are visible at once). Defaults to 0, meaning
  // UNLIMITED/no carousel — the existing behavior every host before this
  // had (MapDashboardComponent's own sidebar, columns=2 and no `rows` at
  // all, still just CSS-grid-wraps every circularChart across as many rows
  // as it needs, no cap, no track/dots markup at all — see the template's
  // own *ngIf splitting the two). A host opts INTO the carousel by setting
  // this to something > 0 (e.g. TrendDashboardComponent's own rows=1,
  // columns=6 — a single-row strip that slides one card at a time once a
  // 7th arrives).
  @Input() rows = 0;

  @Output() sublayersSelected = new EventEmitter<CircularChartSelectionEvent>();

  circularCharts: CircularChartConfig[] = [];
  // How many COLUMNS the track has scrolled past — 0 = showing the first
  // `columns` columns. Reset to 0 whenever circularCharts is rebuilt
  // (applyConfigs()) so a host pushing fresh data/config never leaves the
  // viewer scrolled past the end of a new (possibly shorter) list.
  currentColumnOffset = 0;

  // Items are laid out COLUMN-major (grid-auto-flow: column in the
  // template — column 0 holds items [0..rows), column 1 holds
  // [rows..2*rows), etc.), so a "column" here really means "one more
  // group of up to `rows` cards" — reported live this reads far more like
  // continuous horizontal scrolling than the earlier row-major
  // full-page-at-a-time pagination did, since sliding by one column moves
  // the SAME already-visible cards over by one slot instead of swapping
  // the entire grid's contents out for a whole new set. Floored at 1 so a
  // circularCharts.length of 0 (nothing to show — the template's own outer
  // *ngIf already guards this whole branch on circularCharts.length
  // anyway) still returns a working, non-Infinity column count.
  get totalColumns(): number {
    return Math.max(1, Math.ceil(this.circularCharts.length / Math.max(1, this.rows)));
  }

  // How far the track can scroll — 0 when everything already fits within
  // `columns` visible columns (totalColumns <= columns), same "no
  // scrolling needed" case the dots below also key off to stay hidden.
  // Also 0 whenever rows <= 0 (the plain-grid, no-carousel case — see that
  // Input's own comment) REGARDLESS of totalColumns/columns: totalColumns
  // itself keeps returning a real (often > 1) count even outside carousel
  // mode (Math.max(1, this.rows) above floors rows=0 to 1, it doesn't
  // special-case "no carousel" at all), so without this guard the
  // pagination dots' own `*ngIf="maxColumnOffset > 0"` rendered a full set
  // of dots underneath the plain wrapping grid too — confirmed live with
  // MapDashboardComponent's own single-column fallback (columns=1, rows=0)
  // and 7 charts: totalColumns came out to 7, maxColumnOffset to 6, i.e.
  // six dots controlling a carousel that was never actually on screen.
  get maxColumnOffset(): number {
    return this.rows > 0 ? Math.max(0, this.totalColumns - this.columns) : 0;
  }

  // One dot per PAGE, not per possible scroll position — product decision
  // (confirmed live): with columns=4 and 6 charts, 3 dots stepping one
  // card at a time read as too many/too fine-grained; what's wanted is
  // "how many more clicks to see everything", i.e. ceil(remaining /
  // columns) dots, each jumping a full `columns` at once EXCEPT the last,
  // which only jumps whatever's actually left — so the final page never
  // overshoots past the end into empty/repeated space. Values, not
  // sequential indices (0, columns, 2*columns, ..., maxColumnOffset) — the
  // template's own *ngFor already passes each entry's VALUE straight to
  // goToColumn() (see its own comment), so this only ever needed to
  // produce the right STOPS, never a specific index shape.
  //
  // The track itself still slides via the same CSS transform/transition
  // as before (trackTranslatePercent below, unchanged) — only WHICH
  // offsets get a dot changed here, not how moving between two offsets
  // looks. That distinction matters: this class's own currentColumnOffset
  // comment documents an earlier product decision AWAY from page-at-a-time
  // pagination, specifically because swapping the grid's entire visible
  // contents at once read as items "vanishing" rather than sliding out of
  // view — this still doesn't do that; a page-sized JUMP still animates as
  // one continuous slide across however many columns it crosses, it just
  // no longer stops at every single intermediate column along the way.
  get columnOffsets(): number[] {
    const offsets = [0];
    let offset = 0;
    while (offset < this.maxColumnOffset) {
      offset = Math.min(offset + this.columns, this.maxColumnOffset);
      offsets.push(offset);
    }
    return offsets;
  }

  // The track's own CSS transform (bound inline by the template) — percent
  // is relative to the TRACK's own box, not the viewport (that's just how
  // CSS translateX(%) works), so this only needs totalColumns, not the
  // viewport's own width in px: sliding past `currentColumnOffset` of
  // `totalColumns` equal-width columns is -currentColumnOffset/totalColumns
  // of the track's own full width, regardless of how many of those columns
  // are actually visible at once (that's what the viewport's own
  // overflow:hidden + the track's own width — set from totalColumns/columns
  // in the template — take care of instead).
  get trackTranslatePercent(): number {
    return -(this.currentColumnOffset / this.totalColumns) * 100;
  }

  // Bound directly from the template's own dot buttons (click) — no bounds
  // check needed beyond what columnOffsets already guarantees (every dot's
  // own VALUE is already <= maxColumnOffset, since that's exactly what
  // columnOffsets was built from).
  goToColumn(offset: number): void {
    this.currentColumnOffset = offset;
  }
  // `shape` drives which .nx-circular-chart-swatch--* CSS rule the legend
  // renders (see SeriesPaletteEntry's own comment on why this echoes a
  // map marker's shape without any real dependency on nx-map) — always a
  // real SeriesPaletteShape by the time it lands here, never the raw
  // possibly-unrecognized config value (resolveSeriesPalette() below/
  // toSwatchShape() already normalize it).
  legendItems: { label: string; color: string; shape: SeriesPaletteShape; imageUrl?: string | null }[] = [];
  // rawConfig.SeriesPalette (parsed via parseSeriesPalette() — see its own
  // comment, it arrives as a JSON-encoded string on a real upstream config)
  // when non-empty, else DEFAULT_SERIES_PALETTE — see SeriesPaletteEntry's
  // own comment. Resolved once per applyConfigs() (not
  // read inline at every use) so the legend and every child circular
  // chart's own [palette] binding always agree on the exact same array.
  seriesPalette: SeriesPaletteEntry[] = DEFAULT_SERIES_PALETTE;
  selectedId: string | null = null;

  // rawConfig.ShowLegend read straight through (no separate stored field —
  // there's nothing to resolve/merge, unlike seriesPalette) — only an
  // explicit `false` hides the legend section entirely (see the template's
  // own *ngIf), absent/null keeps the existing always-shown behavior.
  get showLegend(): boolean {
    return this.rawConfig?.ShowLegend !== false;
  }

  // rawConfig.Theme, trimmed — empty/whitespace-only treated the same as
  // absent (no class appended, no themed panel chrome). The template
  // appends this verbatim onto the panel's own class list via [ngClass] —
  // see .nx-circular-chart-panel.elevated (nx-circular-chart-collection.component.scss)
  // for the one value ("elevated") that currently maps to any actual CSS;
  // any other string is a no-op class today, same as none at all.
  get theme(): string | null {
    return this.rawConfig?.Theme?.trim() || null;
  }
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
    // rawConfig.SeriesPalette when the host actually configured one (a
    // JSON-encoded string on a real upstream payload — see
    // parseSeriesPalette()'s own comment), else the shared
    // DEFAULT_SERIES_PALETTE fallback — see SeriesPaletteEntry's own
    // comment. Resolved once here, not per-chart/per-legend-item, so every
    // child <app-nx-circular-chart>'s own [palette] binding below AND the
    // legend built right after always agree on the exact same array.
    const parsedPalette = parseSeriesPalette(this.rawConfig?.SeriesPalette);
    this.seriesPalette = parsedPalette?.length ? parsedPalette : DEFAULT_SERIES_PALETTE;
    this.selectedId = null;
    this.currentColumnOffset = 0;
    // Legend is derived from the UNION of every circular chart's own slice
    // labels/colors, not just the first chart's — different charts in the
    // same collection can each carry their own subset of categories (e.g.
    // DISSOLVED adding an "Other impact" slice no other chart has), and all
    // of them still need to show up in the one shared legend. Dedup by
    // label, keeping the color/shape from wherever that label was first
    // seen (ordered by circularCharts order, then by that chart's own slice
    // order). Shape always comes from this.seriesPalette at that SAME
    // index color would fall back to — a slice's own explicit `color`
    // (CircularChartSlice has no shape field of its own) still borrows its
    // legend shape from the palette slot, since nothing else defines one.
    const seen = new Map<string, { color: string; shape: SeriesPaletteShape; imageUrl?: string | null }>();
    this.circularCharts.forEach(chart =>
      (chart.data ?? []).forEach((d, i) => {
        if (!seen.has(d.x)) {
          const paletteEntry = this.seriesPalette[i % this.seriesPalette.length];
          // Shape: "Image" with no actual ImageUrl has nothing to render —
          // see SeriesPaletteEntry.ImageUrl's own comment — falls back to
          // "Circle" same as any other unrecognized shape rather than
          // rendering a broken/empty swatch.
          const resolvedShape = this.toSwatchShape(paletteEntry.Shape);
          const shape = resolvedShape === "Image" && !paletteEntry.ImageUrl ? "Circle" : resolvedShape;
          seen.set(d.x, {
            color: d.color ?? paletteEntry.Color,
            shape,
            imageUrl: paletteEntry.ImageUrl
          });
        }
      })
    );
    this.legendItems = Array.from(seen, ([label, { color, shape, imageUrl }]) => ({ label, color, shape, imageUrl }));
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

  // Case-insensitive normalization, same reasoning as nx-map's own
  // capitalizeShape() (NXMapBuilderService) — a real upstream config's
  // Shape casing has no reason to match this file's own SeriesPaletteShape
  // literals exactly, and a raw JSON value is untyped at runtime regardless
  // of what SeriesPaletteEntry.Shape claims. Anything absent or not one of
  // the known values (a typo, "Image" with no ImageUrl handling built yet)
  // falls back to "Circle" — the legend always shows SOME recognizable
  // swatch rather than silently rendering nothing.
  private static readonly KNOWN_SWATCH_SHAPES: SeriesPaletteShape[] = [
    "Balloon",
    "Circle",
    "Diamond",
    "Rectangle",
    "Triangle",
    "InvertedTriangle",
    "Image"
  ];

  private toSwatchShape(shape: string | undefined | null): SeriesPaletteShape {
    const match = shape ? NxCircularChartCollectionComponent.KNOWN_SWATCH_SHAPES.find(s => s.toLowerCase() === shape.toLowerCase()) : undefined;
    return match ?? "Circle";
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
