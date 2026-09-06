// Config schema for nx-circular-chart — deliberately independent of nx-map's own
// model/DataSource types (see nx-circular-chart.component.ts's own header comment):
// this component only needs to know which map sub-layer group id a circular chart
// represents so a click can tell the host what to ask the map for. It has
// no idea what a "sub-layer" or "marker" actually is.

// Default slice palette, cycled by index — shared by NxCircularChartComponent
// (a slice's own dataSource color, when CircularChartSlice.color is unset)
// and NxCircularChartCollectionComponent (the legend swatches, derived from
// the first circular chart's own slices). Kept here rather than duplicated
// in each component so the two can never quietly drift out of sync with
// each other.
export const DEFAULT_PALETTE = ["#1f4e79", "#e07b39", "#3fae5a", "#c94a3f", "#8e5ea2", "#3fbfbf"];

// Syncfusion's own AccumulationSeriesModel.type ('Pie'/'Doughnut') plus a
// third SemiCircle case (a Doughnut with its startAngle/endAngle pinned to
// a half turn — see NxCircularChartComponent.buildSeries()'s own comment;
// Syncfusion has no native SemiCircle series type). Values match the
// upstream node's own Type field directly (RawCircularChartNode.Type) —
// mapChartType() in parent-circular-chart-config-transform.ts just falls
// back to Doughnut for anything absent/unrecognized, no other translation.
export enum CircularChartTypes {  
  Doughnut = 1,
  Pie = 2,
  SemiCircle = 3
}

export interface CircularChartSlice {
  // Slice label, also used as the pie's xName value and (absent `tooltip`
  // below) the tooltip text.
  x: string;
  // null means this slice's own reading is genuinely MISSING (the trend
  // API's own Data[0].YValue was null/absent) — distinct from an explicit
  // 0 (a real reading that happens to be zero, e.g. "zero incidents
  // reported"). NxCircularChartComponent's isNoData/isAllZero getters key
  // off exactly this distinction: an all-null chart always renders the
  // plain grey "No data" placeholder (never the zeroAsHealthy badge, even
  // when that's set), while an all-zero (no nulls) chart can. See
  // buildSlices() in parent-circular-chart-config-transform.ts for where a
  // raw YValue becomes this.
  y: number | null;
  color?: string;
  // This slice's own hover-tooltip text, straight from the API's own
  // Data[0].ToolTip (parent-circular-chart-config-transform.ts's buildSlices()) —
  // when a config's own hardcoded Data fallback wants one too, it's just
  // another field on that same JSON object, same as x/y/color. Wins
  // outright over CircularChartCardConfig.tooltipFormat (or the component's own
  // default) whenever non-empty — see NxCircularChartComponent.buildSeries()'s own
  // comment for exactly how.
  tooltip?: string;
}

// One circular chart's own structural configuration — id/label/appearance/sub-layer
// mapping, everything NxCircularChartComponent needs EXCEPT its actual slice values
// (CircularChartConfig.data below). Kept as its own interface purely so
// parent-circular-chart-config-transform.ts's per-field comments (innerRadius/radius
// overrides, etc.) have a natural home independent of `data` — NOT because
// NxCircularChartComponent takes these two as separate inputs; it takes one merged
// CircularChartConfig (see its own comment for why splitting further wasn't useful
// at that boundary — NxCircularChartCollectionComponent already builds one
// fully-resolved object per circular chart before handing it down).
export interface CircularChartCardConfig {
  // Unique across the whole collection — used both as the *ngFor identity
  // and to build the DOM id Syncfusion needs per chart instance (colliding
  // ids break Syncfusion's chart instances).
  id: string;
  label: string;
  // e.g. "40%" — Syncfusion's own string-percentage format, unset renders a
  // solid pie instead of a circular chart.
  innerRadius?: string;
  // Pie vs. Doughnut vs. SemiCircle — see CircularChartTypes' own comment.
  // Unset falls through to NxCircularChartComponent's own default
  // (Doughnut), same as radius/innerRadius/tooltipFormat.
  chartType?: CircularChartTypes;
  // Renders each slice as a 2-stop SVG linear gradient (light-to-dark of
  // that slice's own resolved color) instead of a flat fill — see
  // NxCircularChartComponent.buildSeries()'s own comment for how. Unset/false
  // keeps the existing flat-color rendering.
  applyGradient?: boolean;
  // This circular chart's own OUTER pie radius, same string-percentage format as
  // innerRadius — unset falls through to NxCircularChartComponent's own reduced
  // default (see its buildSeries() comment), not to Syncfusion's own
  // default (which visibly overfills the card, see that same comment).
  radius?: string;
  // This circular chart's own tooltip format, Syncfusion's own placeholder syntax
  // (e.g. "${point.x}: ${point.y}%") — unset falls through to
  // NxCircularChartComponent's own default format, same as radius/innerRadius.
  tooltipFormat?: string;
  // Sub-layer group id(s) on the map this circular chart represents — emitted
  // verbatim on click (defaults to [id] when unset), see
  // NxCircularChartCollectionComponent.onCircularChartSelected(). Not read by the chart.
  sublayerIds?: string[];
  // Opt-in per-card reinterpretation of NxCircularChartComponent.isEmpty
  // (every slice's own y at 0) — unset/false keeps the existing "no data"
  // empty-ring placeholder; true swaps in a green "all clear" badge instead
  // (see NxCircularChartComponent's own isEmpty/healthy comments for why
  // this needs to be opt-in rather than automatic: an all-zero dataSource
  // is ambiguous on its own — "nothing reported yet" for one metric can be
  // "zero incidents, genuinely healthy" for another, and only the config
  // knows which this card is).
  zeroAsHealthy?: boolean;
  // Overrides NxCircularChartComponent's own hardcoded "Healthy" default
  // text on the zeroAsHealthy all-clear badge. Two independent sources, in
  // priority order (buildCircularChartConfig()'s own comment) — the trend
  // API's own TrendLeaf.Label wins outright when present (same
  // API-wins-over-config precedence as chartType/applyGradient above),
  // else RawCircularChartNode.Label (see its own comment for why that
  // generic field). Same field name on both sides deliberately — a host
  // filling in either doesn't need to remember two different names for the
  // same thing. Both absent/empty keeps the "Healthy" default.
  healthyLabel?: string;
}

// CircularChartCardConfig plus its resolved slice values — what
// NxCircularChartCollectionComponent actually builds one of per upstream widget
// config entry (parent-circular-chart-config-transform.ts's own buildCircularChartConfigs()),
// and what NxCircularChartComponent's own `config` @Input takes directly.
export interface CircularChartConfig extends CircularChartCardConfig {
  data: CircularChartSlice[];
}

// Emitted by NxCircularChartCollectionComponent on a card click — everything the
// host needs to forward the selection to the map (or anywhere else) without
// either circular chart component knowing what a "sub-layer" means on the receiving
// end. `allIds` is the full set of every circular chart's own id(s) in this
// collection, so the receiver can tell "everything else in this filter"
// apart from "everything on the map" (e.g. nx-map's applyCircularChartSelectionChange()
// un-labels every OTHER id in `allIds`, leaving ids outside it — like its
// own static mol/surface groups — untouched). `slices` is the selected
// circular chart's own data verbatim (present only when selectedId is set) — a host
// that wants per-slice counts/colors (e.g. nx-map recoloring
// Math.round(slice.y) of a group's EXISTING markers per slice, in that
// slice's color — no new markers created) reads them straight off this.
export interface CircularChartSelectionEvent {
  selectedId: string | null;
  allIds: string[];
  slices?: CircularChartSlice[];
}

// ---- Upstream widget payload shape (parent-circular-chart-config-transform.ts) ----
// Everything below is what buildCircularChartConfigs() (parent-circular-chart-config-transform.ts)
// reads to build the CircularChartConfig[] above — kept in this model file rather
// than alongside that transform's own functions, same split nx-map uses
// between its model file and services/.

// One circular chart card's own upstream node (ComponentType 7120,
// COMPONENT_NXCIRCULAR_CHART) — deliberately typed loosely (only the fields
// parent-circular-chart-config-transform.ts actually reads); a real node carries many
// other unrelated properties (Columns, Icon, WidgetId, ...), all ignored.
export interface RawCircularChartNode {
  ComponentType?: number;
  // The join key against the trend API response's own innermost TrendName
  // (see indexTrendLeaves() in parent-circular-chart-config-transform.ts) — e.g.
  // "TVP", "BSW", "DISSOLVED". Matched case/spacing-insensitively
  // (normalizeName()), same normalization nx-map's slugifyLayerFileName()
  // uses for its own name-matching.
  Name?: string | null;
  // Real upstream widget node's own generic display-label field (present,
  // usually null, on every ComponentType regardless of which one — nothing
  // circular-chart-specific about it). Distinct from Name, which is only
  // ever the trend API join key and this card's own title (label above).
  // The one place this component reads it: overriding the hardcoded
  // "Healthy" text on config.zeroAsHealthy's all-clear badge (see
  // CircularChartCardConfig.healthyLabel's own comment) — a host that wants
  // that badge to read e.g. "No incidents" or "All clear" instead sets
  // Label to that text; absent/empty keeps the "Healthy" default. The trend
  // API's own TrendLeaf.Label (same field name, deliberately) overrides
  // THIS when present, same API-wins-over-config precedence as
  // ChartType/ApplyGradient.
  Label?: string | null;
  // This circular chart's own hardcoded fallback slices, carried right on its config
  // node — used whenever the trend API response has no match (or nothing
  // usable) for this circular chart's Name. See buildCircularChartConfig()'s own comment for
  // the exact override rule: an API match with at least one slice always
  // wins over this, never merged. A JSON-ENCODED STRING, same convention as
  // MainLayerSettings/LayerInlineJSON in nx-map (the real upstream payload
  // never sends structured sub-data as an actual array/object) — parsed by
  // parseNodeData(). A plain CircularChartSlice[] is also accepted, purely so
  // tests/inline callers can hand one in directly without stringifying it
  // first.
  Data?: CircularChartSlice[] | string | null;
  // Display order across the whole collection — ties broken by the
  // Configuration[] array's own declared order (Array.sort() is stable).
  // Absent treated as 0. Deliberately Order, not the upstream node's own
  // PrintOrder field — real-circular-chart-parent-config.json carries both, and
  // Order is the one that reflects the intended display sequence.
  Order?: number | null;
  // This circular chart's own outer pie radius — Syncfusion's own string-percentage
  // format (e.g. "80%"), same convention as CircularChartCardConfig.innerRadius.
  // Per-item override of NxCircularChartComponent's own reduced default (see its
  // buildSeries() comment) — absent/null just falls through to that
  // default, same as innerRadius already does.
  Radius?: string | null;
  // This circular chart's own inner (hole) radius — same string-percentage
  // format and convention as Radius above, maps straight to
  // CircularChartCardConfig.innerRadius. Absent/null falls through to
  // NxCircularChartComponent's own default ("72%"), same as Radius/TooltipFormat.
  InnerRadius?: string | null;
  // Per-circular-chart tooltip format string, Syncfusion's own placeholder syntax
  // (e.g. "${point.x}: ${point.y}%") — already a field on the real upstream
  // node (every sample in real-circular-chart-parent-config.json carries it, just
  // null so far). Absent/null falls through to NxCircularChartComponent's own
  // default format, same as innerRadius/radius already do.
  TooltipFormat?: string | null;
  // Chart shape — same numeric values as CircularChartTypes itself (see its
  // own comment) and the same field name as the trend API's own
  // TrendSeries.ChartType (which overrides this when present — see
  // buildCircularChartConfig()'s own comment), read straight through with
  // no separate mapping. Absent/null falls through to
  // NxCircularChartComponent's own Doughnut default, same as
  // Radius/TooltipFormat.
  ChartType?: number | null;
  // See CircularChartCardConfig.applyGradient's own comment. Absent/null/false
  // renders the existing flat color.
  ApplyGradient?: boolean | null;
  Id?: number;
  // Upstream widget payload's own generic per-node params — when ANY of the
  // three carry a value, buildCircularChartConfig() takes them (in this
  // order, skipping absent/null/empty ones) as this circular chart's own
  // CircularChartCardConfig.sublayerIds, so a click emits those instead of
  // falling back to the normalized Name/Id (see sublayerIds' own comment).
  // All three absent/empty falls straight through to that existing
  // Name/Id fallback, unchanged.
  Param1?: string | null;
  Param2?: string | null;
  Param3?: string | null;
  // Config-only kill switch for this one circular chart card — absent/false
  // (default) renders it as normal; true drops it from the collection
  // entirely, before any trend-leaf matching happens (buildCircularChartConfigs()),
  // so a hidden card never renders even when the trend API has live data for
  // it. Deliberately NOT read from the trend API response (TrendLeaf carries
  // no such field) — a config-only concern, per product decision.
  Hide?: boolean | null;
  // Maps straight to CircularChartCardConfig.zeroAsHealthy — see its own
  // comment. Config-only, same as Hide (no equivalent field on TrendLeaf):
  // whether an all-zero reading means "healthy" is a property of what this
  // card MEASURES, not something the trend API response would know to say
  // per-request.
  ZeroAsHealthy?: boolean | null;
}

// Root collection node (ComponentType 7121, COMPONENT_NXCIRCULAR_COLLECTION)
// — Configuration[] is one RawCircularChartNode per circular chart card.
export interface RawCircularChartCollectionNode {
  ComponentType?: number;
  Configuration?: RawCircularChartNode[] | null;
  // Collection-level heading, rendered once above every circular chart card
  // (NxCircularChartCollectionComponent's own template) — NOT per-card (each
  // RawCircularChartNode already has its own Name for that). Absent/empty
  // renders no heading at all, same as today.
  Title?: string | null;
  // When set, NxCircularChartCollectionComponent fetches the trend response
  // from this URL itself (via NxCircularChartConfigService) and uses THAT
  // (ignoring the `trendResponse` @Input entirely) — see its own comment.
  // Absent/null keeps the existing host-supplies-trendResponse behavior.
  ApiUrl?: string | null;
}

// ---- Trend API response shape ------------------------------------------
// Nested three levels deep: an outer trend GROUP (TrendGroup.Name — not
// used for matching), each holding its own TrendsList of trend NODES, each
// of THOSE holding its own TrendsList of the actual per-metric leaves
// parent-circular-chart-config-transform.ts reads. A real response can carry several
// groups/nodes; every leaf across all of them is searched for a Name match,
// regardless of which group/node it sits under — only the innermost
// TrendName is the join key (confirmed via product decision, not guessed).

export interface TrendDataPoint {
  SeriesID?: string;
  XValue?: string;
  // null/absent means this reading is genuinely missing — see
  // CircularChartSlice.y's own comment for why buildSlices() keeps that
  // distinct from an explicit 0.
  YValue?: string | number | null;
  ToolTip?: string;
  ItemStyle?: { color?: string };
  ItemStyleJson?: string;
  ReportDate?: string;
}

// One slice's worth of upstream data — SeriesName (falling back to
// LegendName) becomes the slice label, Data[0]'s own ItemStyle.color
// (falling back to the series' own Color) becomes the slice color, and
// Data[0]'s YValue becomes the slice value. Confirmed (product decision):
// Data is a single-item array for now — collapsing a future multi-point
// Data[] (a real time series) into one value is an intentionally separate
// change, not handled here.
export interface TrendSeries {
  SeriesName?: string;
  LegendName?: string;
  Color?: string;
  Data?: TrendDataPoint[];
}

export interface TrendLeaf {
  TrendID?: string;
  TrendName?: string;
  // Same numeric values as CircularChartTypes — a per-CHART property (Pie
  // vs. Doughnut vs. SemiCircle applies to the whole circular chart, not
  // one slice), so it sits at this leaf level alongside TrendID/TrendName,
  // not nested under one Series entry. See buildCircularChartConfig()'s own
  // comment for why this overrides RawCircularChartNode.ChartType when
  // present, same API-wins-over-config precedence as `data`.
  ChartType?: number;
  // Same API-wins-over-config precedence as ChartType above, overriding
  // RawCircularChartNode.ApplyGradient when present — see
  // CircularChartCardConfig.applyGradient's own comment for what it does.
  ApplyGradient?: boolean;
  // Same field NAME as RawCircularChartNode.Label (deliberately, so a host
  // filling in either config or API doesn't need to remember two different
  // names for the same thing) and same API-wins-over-config precedence as
  // ChartType/ApplyGradient above — overrides RawCircularChartNode.Label
  // when present. See CircularChartCardConfig.healthyLabel's own comment
  // for what it does (only ever read for the config.zeroAsHealthy all-clear
  // badge's own text).
  Label?: string;
  Series?: TrendSeries[];
}

export interface TrendNode {
  Name?: string;
  TrendsList?: TrendLeaf[];
}

export interface TrendGroup {
  Name?: string;
  TrendsList?: TrendNode[];
}
