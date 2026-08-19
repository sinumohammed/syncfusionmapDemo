// Config schema for nx-circular-chart — deliberately independent of nx-map's own
// model/DataSource types (see nx-circular-chart.component.ts's own header comment):
// this component only needs to know which map sub-layer group id a circular chart
// represents so a click can tell the host what to ask the map for. It has
// no idea what a "sub-layer" or "marker" actually is.

export interface CircularChartSlice {
  // Slice label, also used as the pie's xName value and (absent `tooltip`
  // below) the tooltip text.
  x: string;
  y: number;
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
  // Per-circular-chart tooltip format string, Syncfusion's own placeholder syntax
  // (e.g. "${point.x}: ${point.y}%") — already a field on the real upstream
  // node (every sample in real-circular-chart-parent-config.json carries it, just
  // null so far). Absent/null falls through to NxCircularChartComponent's own
  // default format, same as innerRadius/radius already do.
  TooltipFormat?: string | null;
  Id?: number;
}

// Root collection node (ComponentType 7121, COMPONENT_NXCIRCULAR_COLLECTION)
// — Configuration[] is one RawCircularChartNode per circular chart card.
export interface RawCircularChartCollectionNode {
  ComponentType?: number;
  Configuration?: RawCircularChartNode[] | null;
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
  YValue?: string | number;
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
