import {
  LayerSettingsModel,
  TitleSettingsModel,
  ZoomSettingsModel,
} from "@syncfusion/ej2-angular-maps";
import { FormElementConfig } from "./form-element.model";

export type MapObject = MapPoint | MapLine | MapPolygon | MapCircle;

export interface MapGraphic {
  id?: string;
  type: "point" | "line" | "polygon" | "circle";
}

export interface NXMapConfig extends FormElementConfig {
  MapConfig: string;
}

export interface GeoLocation {
  latitude: number;
  longitude: number;
}

export interface BaseMapObject {
  id?: string;
  name?: string;
  visible?: boolean;
  tooltip?: string;
  metadata?: any;
}

export interface ShapeStyle {
  shape?: MarkerShape;
  color?: string;
  width?: number;
  height?: number;
  // A marker (MapPoint), its group's own style, or the theme can set this —
  // same point -> groupStyle -> theme precedence as every other ShapeStyle
  // field (see toMarker() in nx-map-builder.service.ts). When resolved,
  // toMarker() forces this marker's own shape to MarkerShape.Image
  // regardless of what `shape` above resolves to (Syncfusion only actually
  // renders the image when shape is "Image" — the two aren't independent
  // settings), so a point only needs to set imageUrl to get an icon; it
  // doesn't also need shape: "Image". No imageUrl anywhere in the chain
  // falls back to the ordinary shape-based marker exactly as before this
  // field existed.
  imageUrl?: string;
}

export interface LineStyle {
  color?: string;
  width?: number;
  dashArray?: string;
}

export interface FillStyle {
  background?: string;
  opacity?: number;
  borderColor?: string;
  borderWidth?: number;
}

export interface LabelStyle {
  color?: string;
  size?: string;
  fontFamily?: string;
  fontWeight?: string;
  opacity?: number;
}

export interface MapPoint extends BaseMapObject, GeoLocation, ShapeStyle {
  animationDuration?: number;
  // Nested child points in the source config (e.g. "Surface DALEEL" under
  // "AL GHUBAR - surface"). These are flattened into sibling markers by the
  // builder and never appear on the objects handed to Syncfusion.
  points?: MapPoint[];
  // Optional reading (flow rate, pressure, etc.) shown as a second line
  // under the marker's name label — see toMarker()/buildMarkerPoints() in
  // nx-map-builder.service.ts. Omit to render just the name, same as before
  // this field existed.
  value?: number;
  unit?: string;
  // This point's own always-on hover tooltip data — every metric it has a
  // reading for, keyed by a slugified metric id (NxMapDemoComponent.
  // slugifyMetricId() of that reading's own TooltipComponentEntry.Label —
  // "api", "bs_w", whatever a MetricOverlayRecord.Tooltip.ComponentList
  // happens to carry). Set by NxMapDemoComponent.applyMetricSelection() from
  // a matched record's own `Tooltip.ComponentList` — NOT by
  // activeMetricId/activeMetricValues (that's still
  // only ever ONE metric, driving the separate on-map overlay label/color,
  // unaffected by this). NXMapBuilderService.toMarker() reads these keys
  // (scoped to NXMapBuilderService.setTooltipMetricKeys() — see its own
  // comment) to populate the hover tooltip's v_/u_/c_<key> fields; a key
  // this point has no entry for here just renders the template's own
  // placeholder ("—"), same as before this field existed. No hardcoded
  // metric-id list involved on either side.
  tooltipMetrics?: Record<string, PointMetric>;
  // This point's OWN hover-tooltip column count — overrides the map-wide
  // default (NxMapDemoComponent.deriveTooltipTemplate()'s own `columns`,
  // itself a static layer's MapConfig.tooltipTemplate.columns or
  // NXMapBuilderService.DEFAULT_TOOLTIP_TEMPLATE.columns) for JUST this
  // one point's tooltip — every other point keeps using the default.
  // Set from MetricOverlayRecord.Tooltip's own `Columns` field
  // (see its own comment) — omit there to leave this point on the
  // default, same as every point before this field existed. Read by
  // NXMapBuilderService.toMarker() into this marker's own `columns`
  // field, substituted into the tooltip template's CSS grid
  // (`grid-template-columns`) at hover time — a genuinely PER-MARKER
  // layout, not a template-wide setting, despite every marker sharing
  // the same underlying #marker-tooltip-template DOM element.
  tooltipColumns?: number;
  // This point's OWN hover-tooltip tile STYLE variant — a name into
  // NxMapDemoComponent's TOOLTIP_TILE_LAYOUTS-adjacent CSS variants
  // (applied as class "mtt-layout-<name>" on this marker's own tooltip
  // instance), overriding the map-wide default (a static layer's own
  // MapConfig.tooltipTemplate.layout, or "default") for JUST this one
  // point — every other point keeps using the default. Set from
  // MetricOverlayRecord.Tooltip — no per-point tile-style field exists in
  // that shape today (see MetricOverlayTooltip's own comment), so this
  // currently only ever comes from... nothing; always the map-wide
  // default. Read by NXMapBuilderService.toMarker() into this
  // marker's own `layoutClass` field, substituted into the tooltip
  // template's outer element class at hover time — same per-marker
  // substitution trick as tooltipColumns above, which is why every named
  // layout has to be a CSS-only restyling of the one shared tile markup
  // (spacing/icon position/color...), not a different HTML structure per
  // tile — the template's actual markup is still built ONCE, shared by
  // every marker; only which CSS rules apply to it varies per marker.
  tooltipLayout?: string;
  // Overrides the host group's own MapGroup.minZoomLevel for just THIS
  // point — set one or the other, not expecting both to blend; see
  // MapGroup.minZoomLevel's own comment for exactly what the threshold
  // means. Lets a group that's otherwise always visible single out just
  // its "well"/station-style points to wait for a closer zoom, without
  // moving them into a separate group.
  minZoomLevel?: number;
  // Master-data third-party classification, authored directly on this point
  // in mol.json (or whichever layer file) rather than supplied per-click by
  // the trend/metric-overlay API — mol.json already knows this per point,
  // so duplicating an equivalent flag into every metric-overlay-response.json
  // record would risk the two drifting apart. Unset/omitted means false —
  // every mol.json point should set this explicitly (false for a normal/
  // in-house point, true for a third-party one) rather than relying on the
  // default, so it's clear at a glance which points were actually
  // classified. NOT YET READ anywhere — this is a scaffold field, wiring it
  // into the overlay's color/shape resolution is a follow-up.
  isThirdParty?: boolean;
}

export interface PointMetric {
  value: number;
  unit?: string;
  // Reserved for a tooltip tile's optional second/third line (see
  // TooltipTemplateConfig) — undefined today for every point in every mock
  // dataset, which is exactly what keeps that line hidden (see
  // NXMapBuilderService.toMarker()'s d2_<key>/d3_<key> fields). Populate
  // these once a real reading actually needs a second value under the
  // first (e.g. a min/max pair) — no other code change needed, the tile
  // shows up automatically.
  value2?: number;
  unit2?: string;
  value3?: number;
  unit3?: string;
  // This metric's own display name, straight from the data — only
  // meaningful on an entry converted from MetricOverlayRecord.Tooltip.ComponentList (ignored
  // everywhere else PointMetric is used, e.g. activeMetricValues).
  // NxMapDemoComponent derives its hover-tooltip tile list from whatever
  // keys show up across a fetch's own records — this is that tile's
  // title, so a metric id NO config anywhere has ever declared still gets
  // a real, human title instead of just the key itself uppercased (still
  // the fallback when this is omitted). A layer's own MapConfig.
  // tooltipTemplate.items entry for the same metricId, when one exists,
  // wins over this — same "explicit config beats derived default"
  // precedence as everywhere else in this app.
  label?: string;
  // This reading's own highlight color, straight from the API response —
  // no hardcoded per-metric-id palette anywhere in code (NXMapBuilderService
  // no longer has a METRIC_COLORS lookup). Read by toMarker() for the hover
  // tooltip tile's value color, and by toMetricOverlayMarker() (via a
  // matched MetricOverlayRecord's own Color, converted onto this same
  // lowercase field by NxMapDemoComponent.toPointMetric()) for the on-map
  // overlay marker's color/shape once that metric's circular chart is
  // clicked — see that method's own comment for the full priority order.
  // Omit to fall back to that point's own mol.json/group/theme color.
  color?: string;
  // This reading's own explicit marker shape override — same tier-1
  // priority as `color` above in toMetricOverlayMarker()'s resolution
  // order (an explicit reading.shape always wins outright). Omit this to
  // fall straight through to that point's own mol.json/group/theme shape,
  // same as `color` does. Typed as MarkerShape (matching ShapeStyle.shape
  // exactly, since NxMapDemoComponent.toPointMetric() copies a matched
  // MetricOverlayRecord's own Shape straight onto this field) even though
  // whatever actually comes through here only ever needs case-insensitive
  // comparison — see
  // toOverlayIconShape() in nx-map-builder.service.ts, which normalizes/
  // validates it regardless.
  shape?: MarkerShape;
  // Overrides the metric-overlay LABEL TEXT's own color independently of
  // `color` above (which still drives the icon, and is this field's own
  // fallback when omitted) — see toMetricOverlayMarker()'s own comment for
  // the exact resolution. Lets a deployment keep the icon in its usual
  // marker/compliance color while making the text itself a different,
  // more readable color for a specific reading, without having to touch
  // `color` (which would recolor the icon too).
  textColor?: string;
  // Explicit false blanks just the on-map overlay's own LABEL TEXT (the
  // matched point's name + this reading's value/unit — see
  // toMetricOverlayMarker()'s own `label` construction) for THIS reading,
  // straight from a matched MetricOverlayRecord's own ShowInfo (see its own
  // comment) via NxMapDemoComponent.toPointMetric(). The marker itself
  // (icon, color, position) still renders as normal — this only empties the
  // text, it does NOT remove the point from activeMetricValues the way
  // omitting a match entirely would. Omit (or true) to show the label as
  // normal, same as before this field existed.
  showInfo?: boolean;
}

// One entry in the response NXMapConfigService.loadDataOverlay() fetches
// on a circular chart click (NXMapAppConfig.dataApiUrl) — a metric reading
// plus enough to find (or create) the marker it belongs on. PascalCase
// throughout (LayerId/MarkerId/Value/...), matching the real metric-overlay
// API's own wire convention — deliberately NOT extending PointMetric/
// ShapeStyle (both lowercase, and used everywhere ELSE in this app: mol.json
// points, theme config, MapPoint itself) the way this interface used to;
// NxMapDemoComponent.toPointMetric()/applyMetricSelection() convert a
// matched/created record's own fields into those lowercase internal shapes
// at the one boundary where this wire record meets the rest of the map
// (MapGroup.activeMetricValues, a brand-new point's own MapPoint fields),
// so nothing downstream of that conversion needs to know this interface's
// casing differs from its own.
//
// Matched by NxMapDemoComponent's own algorithm (see
// applyCircularChartSelectionChange()): `MarkerId` resolving to an existing
// point (scoped to `LayerId`'s own layer when given, or matched against
// every layer when omitted) anchors the reading to that point, exactly like
// MapGroup.activeMetricValues already does; a `MarkerId` that doesn't
// resolve but carries its own `Latitude`/`Longitude` instead plots as a
// brand-new point (on `LayerId`'s own layer when that resolves, otherwise
// the main layer), using `Id` (or `MarkerId` if `Id` is omitted, or an
// auto-generated one if both are) as THIS new point's own MapPoint.id;
// neither MarkerId/Latitude+Longitude resolving is a console.error +
// on-screen toast, that record skipped. A deployment's own backend decides
// how it computes/attributes each reading — this map only ever cares about
// these extra fields on top of the reading itself.
export interface MetricOverlayRecord {
  LayerId?: string;
  MarkerId?: string;
  // Only meaningful for a brand-new (unanchored) point — its own identity,
  // independent of `MarkerId` (which always means "match this EXISTING
  // marker", whether or not that match actually resolves). Omit to fall
  // back to `MarkerId` (even an unresolved one) or, failing that, an
  // auto-generated id.
  Id?: string;
  Latitude?: number;
  Longitude?: number;
  Name?: string;
  // This reading's own value/status — Value is coerced to a number
  // wherever it's actually read (NxMapDemoComponent.toPointMetric()), same
  // "API may send either a number or a numeric string" tolerance
  // TooltipComponentEntry.Value already has to allow for.
  Value?: string | number;
  Unit?: string;
  Value2?: string | number;
  Unit2?: string;
  Value3?: string | number;
  Unit3?: string;
  Label?: string;
  Color?: string;
  Shape?: MarkerShape;
  TextColor?: string;
  // Shape/Color/Width/Height/ImageUrl/TextColor are only meaningful for a
  // brand-new (unanchored) point — forwarded straight onto that point's own
  // MapPoint fields in NxMapDemoComponent.applyMetricSelection(), which
  // already take precedence over the ad hoc group's own style/theme (see
  // NXMapBuilderService.toMarker()'s point -> groupStyle -> theme
  // resolution order). Omit any/all to just inherit the ad hoc group's own
  // theme (METRIC_OVERLAY_GROUP_ID's `theme`, see its own comment) like
  // every other ad hoc point.
  Width?: number;
  Height?: number;
  ImageUrl?: string;

  // The FULL multi-metric snapshot for this point's always-on hover
  // tooltip — independent of which single metric this record's own
  // Value/MarkerId are actually about (that pair still only
  // ever drives the ONE selected metric's on-map overlay label/color,
  // exactly as before this field existed). NxMapDemoComponent derives each
  // tile's own key from ComponentList's own Label (see
  // MetricOverlayTooltip's own comment) — a metric this record's
  // ComponentList doesn't mention just leaves that tile's placeholder in
  // place. Forwarded onto the matched (or brand-new) point's own
  // tooltipMetrics in NxMapDemoComponent.applyMetricSelection() — omit
  // entirely to leave the point's tooltip untouched by this record.
  // `Columns` is this point's own per-point tile-count override (PER-POINT,
  // not global: forwarded onto just the one point this record matches/
  // creates as MapPoint.tooltipColumns — every other point keeps using the
  // map-wide default, a static layer's own MapConfig.tooltipTemplate.columns
  // when set, otherwise NXMapBuilderService.DEFAULT_TOOLTIP_TEMPLATE.columns).
  Tooltip?: MetricOverlayTooltip;
  // Explicit false blanks just this record's own on-map overlay LABEL TEXT
  // (its MarkerId's point name + Value + Unit — see PointMetric.showInfo's
  // own comment for exactly what renders instead) for the currently
  // selected metric — the overlay marker itself (icon, color, position)
  // still renders as normal, this is NOT the same as the MarkerId never
  // having matched this round. Does NOT touch this same record's own
  // `Tooltip.ComponentList` either — that always-on hover-tooltip snapshot
  // is already independent of the active-metric label (see this
  // interface's own header comment) and keeps applying regardless. Omit
  // (or true) to show the overlay label as normal, same as before this
  // field existed.
  ShowInfo?: boolean;
}

// One metric reading inside MetricOverlayRecord.Tooltip.ComponentList — the
// wire shape a real metric-overlay API sends this point's full multi-metric
// hover-tooltip snapshot in. No explicit metric id of its own: Label is a
// human title ("API", "BS&W", ...), and NxMapDemoComponent derives a stable
// key for it by slugifying Label (lowercased, non-alphanumeric runs
// collapsed to "_") — see its own toTooltipMetrics()/deriveTooltipTemplate()
// comments. PascalCase field names are read straight off the API, no
// separate mapping layer.
export interface TooltipComponentEntry {
  Label?: string;
  Color?: string;
  Value?: string | number;
  Unit?: string;
}

// MetricOverlayRecord.Tooltip's own shape — Columns is a real field here,
// not a magic reserved key mixed in among the metrics themselves the way
// the old free-form Record<string, PointMetric | number | string> map's own
// "columns"/"template" keys used to be. (No per-point tile-STYLE override
// in this shape — MapPoint.tooltipLayout now only ever comes from the
// map-wide default; add a `Template` field here the same way if a future
// API needs that back.)
export interface MetricOverlayTooltip {
  Columns?: number;
  ComponentList?: TooltipComponentEntry[];
}

// One tile in the hover tooltip's metric grid — `metricId` can be any
// string. This full item list is never required to be authored by hand:
// NxMapDemoComponent.deriveTooltipTemplate() auto-builds one entry per
// distinct slugified id (NxMapDemoComponent.slugifyMetricId()) found across
// a fetch's own MetricOverlayRecord.Tooltip.ComponentList entries (title
// from that component's own Label) — a config's own MapConfig.tooltipTemplate.items
// (below) only needs an entry for a metricId at all when it wants to
// PIN that tile's title/position explicitly; any key the data mentions
// that config doesn't already know about still gets a tile automatically.
// Whatever the FINAL merged list ends up being, NxMapDemoComponent feeds
// it straight into NXMapBuilderService.setTooltipMetricKeys(), so it's
// always exactly the set toMarker() computes real template fields for —
// no separate hardcoded metric-id list anywhere has to stay in sync.
export interface TooltipTemplateItem {
  metricId: string;
  title?: string;
}

// Drives the hover tooltip's whole layout — `columns` tiles per row,
// `items` in display order (wraps to a new row every `columns` items,
// then whatever the fetched data adds beyond that — see
// TooltipTemplateItem's own comment). Set on the MAIN layer's MapConfig
// (MapConfig.tooltipTemplate) to pin an explicit column count/tile
// order/custom titles; entirely optional otherwise — omit it and
// NxMapDemoComponent.deriveTooltipTemplate() builds a working tooltip
// straight from whatever the fetched metric data contains, no static
// declaration required at all. There's exactly one tooltip template live
// at a time app-wide (see NxMapDemoComponent.injectMarkerTooltipTemplate()'s
// own comment) — with NxMapCollectionComponent looping over several maps,
// whichever map's config resolves first wins for all of them.
export interface TooltipTemplateConfig {
  columns: number;
  items: TooltipTemplateItem[];
  // Selects which HTML layout renders each tile — a key into
  // NxMapDemoComponent's own TOOLTIP_TILE_LAYOUTS registry (see its own
  // comment). Omit for "default" (today's title + value/unit + optional
  // value2/value3 card). A different deployment that wants a differently
  // shaped tile can add a new named entry to that registry and select it
  // here — no changes needed anywhere else in this pipeline (key
  // derivation, marker field population, matching rules all stay the
  // same regardless of which layout renders the result).
  layout?: string;
}

export interface MapLine extends BaseMapObject, LineStyle {
  // Raw waypoint coordinates — still supported for a waypoint that isn't a
  // real named marker (e.g. a bend in a pipeline route). Optional because
  // `pointIds` below is the preferred way to define a line: it references
  // markers by id rather than repeating their lat/long, so a marker only
  // ever needs to be moved in ONE place (its own point definition) instead
  // of also updating every line that happens to pass through it.
  points?: MapPoint[];
  // Ordered list of marker ids (MapPoint.id, via BaseMapObject) this line
  // connects — resolved by the builder against every marker point in this
  // line's LAYER (not just its own group, so a line can connect markers
  // living in different groups). Takes precedence over `points` when set;
  // an id that doesn't match any known marker logs a warning and that
  // waypoint is skipped rather than breaking the whole line.
  pointIds?: string[];
  angle?: number;
}

export interface MapPolygon extends BaseMapObject, FillStyle {
  points: GeoLocation[];
}

export interface MapCircle extends BaseMapObject, FillStyle {
  center: GeoLocation;
  radius: number;
  segments?: number;
}

export interface MarkerConfig {
  // border is deliberately NOT part of ShapeStyle (which MapPoint also
  // extends) — Syncfusion's MarkerBaseModel.border applies to the whole
  // marker layer (i.e. this GROUP), with no per-point borderColorValuePath/
  // borderWidthValuePath the way shape/color/width/height have (confirmed
  // against MarkerBaseModel in ej2-maps' own base-model.d.ts). So this only
  // overrides the border for every point in this group, never a single
  // point on its own — see resolveGroupTheme()/buildMarkerPointsForGroup()
  // in nx-map-builder.service.ts, which reads this ahead of theme.marker.border.
  style?: ShapeStyle & { border?: { width?: number; color?: string } };
  clusterConfig?: ClusterConfig;
  points?: MapPoint[];
}

export interface MapGroup {
  id: string;
  name: string;
  visible?: boolean;
  markerConfig?: MarkerConfig;
  lines?: MapLine[];
  polygons?: MapPolygon[];
  circles?: MapCircle[];
  metadata?: any;
  // Buckets this group under a toggleable heading node in the filter tree
  // (e.g. "Facilities", "Wells") alongside any other group sharing the same
  // string, typically used for groups arriving from a sub-layer API call.
  // Groups without a heading render exactly as before — directly under
  // their layer, no extra nesting.
  heading?: string;
  // Per-group theme override — same lookup as MapConfig.theme (a name into
  // nx-map-themes.json), but decided by THIS group's own data rather than
  // the static layer config. Exists specifically for sub-layer API groups:
  // the layer they get merged into (see rebuildMap() in
  // nx-map-demo.component.ts) is fixed at config time, but each group the
  // API returns can carry its own theme, e.g. one API response bucketing
  // some groups under "theme1" and others under "theme2". Falls back to the
  // layer's own theme when unset — inline point/polygon/circle/line fields
  // still win over both.
  theme?: string;
  // Default unset/null. When set to a metric id, every marker in this
  // group that HAS a reading for it (via activeMetricValues below)
  // ADDITIONALLY renders a persistent label overlay (on top of its normal
  // shape+color+cluster rendering, which is unaffected) showing that
  // metric's own value — see buildMarkerPoints() in
  // nx-map-builder.service.ts. Each point's label color is that reading's
  // own PointMetric.color when its status is "high", NORMAL_LABEL_COLOR
  // otherwise. Set by
  // NxMapDemoComponent.circularChartSelection when an external panel (e.g. a
  // circular chart/category chart) selects a metric — cleared (null) again once
  // nothing is selected.
  activeMetricId?: string | null;
  // The freshly-fetched per-point values for activeMetricId — see
  // NXMapConfigService.loadDataOverlay() and
  // NxMapDemoComponent.applyCircularChartSelectionChange()'s own comment. Keyed by
  // point id (MapPoint.id via BaseMapObject, or a synthesized id for a
  // brand-new unanchored point). toMetricOverlayMarker() in
  // nx-map-builder.service.ts reads this for the overlay label/color — a
  // point with no entry here (activeMetricId set, but this map has nothing
  // for that point id) renders with no overlay at all, same as a point
  // with no reading. Unset/null (no selection) clears every overlay.
  activeMetricValues?: Record<string, PointMetric> | null;
  // Default false. Controls whether this group's own markers/polygons/
  // circles/lines get their own checkbox rows in the filter tree, nested
  // under this group's row — NOT whether they render on the map, which is
  // unaffected either way. False (or unset) shows just this group's own
  // summary row (still fully toggleable — unchecking it hides every leaf
  // underneath exactly as before, see toggleGroup()), same as a group with
  // no leaves at all; true expands it into the previous per-leaf checkbox
  // list (one row per marker/polygon/circle/line).
  childrenParticipateInFilter?: boolean;
  // Below this map zoom factor (same units/scale as MapConfig.zoomFactor/
  // maxZoomFactor — see their own comments — read live off the map via
  // NXMapBuilderService.setZoomLevel(), called from NxMapDemoComponent.
  // onZoomComplete() on every zoom), every marker in this group hides
  // entirely (NXMapBuilderService.buildMarkerPoints() drops it from the
  // dataSource it hands Syncfusion, same as point.visible === false
  // already does) — not just dimmed, gone from the map the same way
  // unchecking the group would, though the filter-tree checkbox itself is
  // untouched; this is purely zoom-driven and independent of it. At or
  // above this level, markers show normally (subject to visible/checkbox
  // state as always). Omit to ignore zoom entirely — every point always
  // visible regardless of zoom, same as before this field existed. A
  // point's OWN MapPoint.minZoomLevel overrides this group-level default
  // for just that one point when set — e.g. singling out only a group's
  // "well"/station-style points to wait for a closer zoom while the rest
  // of the group stays visible throughout.
  minZoomLevel?: number;
}

export interface DataLabel {
  visible?: boolean;
  color?: string;
  opacity?: number;
}

// Theme schema — one named entry in nx-map-themes.json. Every field here
// maps 1:1 to a fallback the builder applies when the corresponding
// group/point/line/polygon/circle field is omitted in the config JSON —
// whatever's supplied inline always wins over the theme. Deliberately
// scoped to fields the builder actually reads today; e.g. marker-level
// labelStyle isn't wired to any Syncfusion rendering, so it has no theme
// counterpart here.
export interface MapThemeMarker {
  shape?: MarkerShape;
  color?: string;
  width?: number;
  height?: number;
  border?: { width?: number; color?: string };
  imageUrl?: string;
}

export interface MapThemeCluster extends ShapeStyle {
  labelStyle?: LabelStyle;
}

export interface MapThemeLine {
  color?: string;
  width?: number;
  dashArray?: string;
}

export interface MapThemeFill {
  background?: string;
  opacity?: number;
  borderColor?: string;
  borderWidth?: number;
}

export interface MapThemeTooltip {
  border?: { width?: number; color?: string };
}

export interface MapThemeDataLabel {
  color?: string;
  opacity?: number;
}

// The layer's OWN shape/region fill (shapeSettings.fill — the color
// filling the country/region boundary itself, distinct from any
// marker/polygon/circle drawn on top of it). Applies uniformly to every
// layer using this theme, main or sub — MapConfig.background overrides it
// per-layer for the (common) case where main vs. sub-layers need visibly
// different fills.
export interface MapThemeLayer {
  background?: string;
  borderColor?: string;
  borderWidth?: number;
}

export interface MapTheme {
  marker?: MapThemeMarker;
  cluster?: MapThemeCluster;
  line?: MapThemeLine;
  polygon?: MapThemeFill;
  circle?: MapThemeFill;
  tooltip?: MapThemeTooltip;
  dataLabel?: MapThemeDataLabel;
  layer?: MapThemeLayer;
}

// nx-map-themes.json's shape — a flat registry keyed by theme name.
export type MapThemeRegistry = Record<string, MapTheme>;

export interface MapConfig {
  // No isMainLayer flag — which config is "main" is purely positional:
  // NXMapBuilderService.initialize() always treats configs[0] as the base/
  // main layer (see its own comment), so it's whichever config the caller
  // puts first, never a value baked into the config itself. A caller
  // constructing configs[] (e.g. parent-config-transform.ts's
  // buildAppConfig(), or nx-map-demo.component.ts's rebuildMap()) is
  // responsible for putting the intended main/parent layer first and every
  // other (child/static) layer after it — if more than one candidate ever
  // looked like a "parent", only the first one in that array actually
  // becomes main; the rest are simply treated as static/child layers, with
  // no separate flag to search for or disagree with.
  layerName: string;
  // Optional layer-tree grouping label, independent of parentLayerName
  // (which controls WHICH layer this one nests under, not how it's
  // presented alongside its siblings there). When set, this layer renders
  // inside a toggleable "<region>" folder next to every sibling layer
  // (root-level, or under the same parent) sharing the same region string,
  // instead of listed directly — see getLayerTree()'s groupByRegion() in
  // nx-map-builder.service.ts. Omit to keep this layer a direct sibling,
  // exactly as before regions existed.
  region?: string;
  title?: TitleConfig;
  zoom?: ZoomConfig;
  dataLabel?: DataLabel;
  groups?: MapGroup[];
  // Default true. Set to false to exclude this layer entirely at build
  // time — it won't be added to the map AND won't appear in the layer
  // panel's filter tree at all. Unlike setLayerVisible() (a runtime
  // show/hide toggle on a layer that's still present in the tree), this is
  // a config-time cut — use it for layers that shouldn't be offered as an
  // option in this deployment at all. Ignored (with a console.warn) on the
  // main layer, since every other layer renders relative to it.
  visible?: boolean;
  // Default true. Set to false to keep this layer fully present on the map
  // AND in the filter tree, but start it UNCHECKED — same as if a user
  // unchecked it right after load. Unlike `visible: false` (a config-time
  // EXCLUSION — gone from both the map and the filter tree entirely), this
  // only affects the starting checked/unchecked state; the layer is still
  // there to check back on. Normally set per-layer inline, but
  // NxMapDemoComponent.loadMap() also derives it from the base layer's own
  // LayersDefaultSelected (parent-config-transform.ts) when that's
  // present — see its own comment for the precedence between the two.
  // Ignored (with a console.warn) on the main layer, same exemption as
  // `visible` above — its checkbox is disabled, so starting it unchecked
  // would leave no way to check it back on.
  selected?: boolean;
  // This layer's own shape/region fill (shapeSettings.fill) — the color
  // filling the country/region boundary itself, not any marker/polygon/
  // circle drawn on top of it. Overrides the theme's layer.background
  // (nx-map-themes.json) when set; omit to use the theme's value, or the
  // builder's own hardcoded default (opaque grey for the main layer,
  // translucent blue for a SubLayer) if neither sets one — see buildLayers()
  // in nx-map-builder.service.ts. Set to "transparent" (or "none") for a
  // border-only shape with no fill at all.
  background?: string;
  // This layer's own shape/region border (shapeSettings.border) — same
  // precedence as background above (this field, then the theme's
  // layer.borderColor/borderWidth, then the builder's hardcoded default of
  // a thin #A6A6A6 line). Independent of background, so a fully
  // transparent fill can still keep a visible outline.
  borderColor?: string;
  borderWidth?: number;
  // "shape" (default) renders this layer from `shapeData` (a GeoJSON
  // boundary, bound to markers/polygons via shapePropertyPath/name). "osm"
  // and "satellite" render free raster tiles instead (OpenStreetMap streets,
  // or Esri World Imagery satellite photography respectively) — no
  // shapeData, no named-region binding for THIS layer, but groups/markers/
  // polygons still overlay on top of it normally. Only meaningful on the
  // main layer (see NXMapBuilderService.buildLayers()); when the main layer
  // starts as one of these two, NXMapBuilderService.setBaseMapType() can
  // swap between them at runtime (e.g. a "Map" / "Satellite" UI toggle).
  // A config may write "simple" instead of "shape" here (and in
  // availableBaseMapTypes below) — NxMapDemoComponent normalizes it to
  // "shape" as soon as the config resolves, purely so config authors get
  // the friendlier name shown in the dropdown ("Simple") without this type
  // (or anything that compares against it, e.g.
  // NXMapBuilderService.isTileBaseMapType()) needing to know a second
  // spelling exists.
  baseMapType?: "shape" | "osm" | "satellite";
  // Which of the three baseMapType values the base-map style switcher
  // offers, and in what order — a comma-separated string (e.g.
  // "shape,satellite,osm", or "simple,satellite,osm" — see baseMapType's
  // own comment on the "simple"/"shape" alias), read by NXMapDemoComponent
  // to build the Simple/Map/Satellite dropdown. baseMapType above is still
  // the SELECTED value; this only controls what the dropdown lists and in
  // which order. Omit (or leave unset) to offer all three, in the default
  // shape/osm/satellite order.
  availableBaseMapTypes?: string;
  // Only meaningful on the MAIN layer (MapOptions.centerPosition/
  // zoomSettings.zoomFactor are root-level in Syncfusion, not per-layer).
  // Shape layers auto-fit zoom/center to their shapeData's bounding box, so
  // these are normally unnecessary — but an "osm" base layer has no
  // shapeData to fit against, so without an explicit center/zoom here the
  // map defaults to a whole-world view: your region becomes a speck and
  // markers shrink below a visible pixel size (they're still there, just
  // too small to see — lines stay visible since a path still has a
  // minimum visible stroke width at any zoom).
  mapCenter?: GeoLocation;
  zoomFactor?: number;
  // Only meaningful on the MAIN layer, same as mapCenter/zoomFactor above —
  // Syncfusion's ZoomSettingsModel.maxZoom defaults to 10 when left unset,
  // which silently caps how far in an "osm"/"satellite" tile main layer can
  // zoom regardless of what the tile provider itself can actually serve at
  // that location (reported live: satellite mode stopped zooming well
  // before individual wells/stations became visible, even though the same
  // ArcGIS World Imagery tiles serve much closer zoom levels fine — this
  // was Syncfusion's own default ceiling, not a provider limitation).
  // NXMapBuilderService.buildZoom() uses this when set, falling back to 19
  // (near the deepest zoom level slippy-map tile schemes like OSM/ArcGIS
  // generally support) rather than Syncfusion's own low default. A "shape"
  // main layer ignores this — its own auto-fit zoom has no comparable cap.
  maxZoomFactor?: number;
  // Filter-tree-only nesting hint: this layer still renders as its own
  // independent Syncfusion SubLayer (own shapeData/geometry), but
  // getLayerTree() nests its node under the layer whose layerName matches
  // this value instead of listing it as a top-level sibling. Used for
  // static layers that should appear "under Oman" in the filter popup.
  parentLayerName?: string;
  // Default true. Set to false to keep this layer rendering on the map
  // (unlike visible: false, which excludes it from the map AND the filter
  // entirely) while omitting it from the filter tree altogether — no
  // toggle offered for it, so a deployment can bake in a layer without
  // exposing it as a user-facing option.
  participateInFilter?: boolean;
  // Only meaningful on the MAIN layer's own config (MainLayerSettings) —
  // shows/hides the coordinate-picker toolbar button (click empty map
  // area to drop a temporary lat/long marker, see
  // NxMapDemoComponent.dropCoordinatePin()'s own comment). Default false
  // (hidden) when unset — a deployment has to explicitly opt in. Also
  // hidden outright in "shape" base-map mode regardless of this setting
  // (coordinate picking isn't supported there — see
  // dropCoordinatePin()'s own comment).
  coordinatePickerEnabled?: boolean;
  // Default false. When true AND this layer's shapeData is a multi-feature
  // FeatureCollection (e.g. Al Wusta's "Lekhwair"/"Qarn Alam" clusters), the
  // filter tree lists each feature as its own checkbox row (with a
  // "(<count>)" suffix on the layer's own label) so one polygon can be
  // shown/hidden independently of the rest of the layer. Left false (or a
  // single-shape layer), the filter tree behaves exactly as before — just
  // the one layer-level checkbox, no per-feature breakdown.
  shapeFeaturesSelectable?: boolean;
  // Selects a named entry from nx-map-themes.json to supply fallback
  // style/color/dimension values for this layer's markers, clusters, lines,
  // polygons, circles, tooltip border, and dataLabel, for whichever of
  // those fields the config doesn't set inline. Missing/unrecognized names
  // resolve to "default", which reproduces the builder's original
  // hardcoded fallbacks exactly — layers that don't set this see no visual
  // change.
  theme?: string;
  // Settable on the main layer OR any static child layer (e.g. MOL, which
  // is where marker metrics actually live) — NxMapDemoComponent.loadMap()
  // checks the main layer first, then each static layer in order, using
  // the first one it finds. See TooltipTemplateConfig's own comment for
  // why there's only one live template app-wide. Omit everywhere to fall
  // back to NXMapBuilderService.DEFAULT_TOOLTIP_TEMPLATE (the original
  // 7-metric, 2-column layout).
  tooltipTemplate?: TooltipTemplateConfig;
}

// A value that's either hardcoded inline, loaded from a static file, or
// fetched from a live API — the same three interchangeable sources apply
// to both a layer's group/marker config and its shape/boundary geometry.
export interface DataSource<T> {
  source: "inline" | "file" | "api";
  value?: T; // required when source === "inline"
  url?: string; // required when source === "file" | "api" (HttpClient.get either way)
}

// What a child layer brought in via LayerFileLists/LayerAPIURL/
// LayerInlineJSON (parent-config-transform.ts) resolves to — one per
// layer. `shapeData` present + non-null means a real GeoJSON boundary
// (Al Wusta/Surface/Sub Surface-style); omitted/null means a points/
// groups layer (MOL-style), and NxMapDemoComponent.loadMap() synthesizes
// NXMapBuilderService.EMPTY_PLACEHOLDER_SHAPE in its place — which case
// this is is inferred purely from presence, no separate "type" field.
export interface LayerFileEnvelope {
  shapeData?: any;
  layerConfig: MapConfig;
}

export interface MapState {
  groups: MapGroup[];
}

// Mirrors CircularChartSelectionEvent (nx-circular-chart-model.ts) in shape — same
// independent-shape-mirroring convention so nx-map still shares nothing with
// nx-circular-chart at the type level. Bound as an @Input on NxMapCollectionComponent/
// NxMapDemoComponent (see NxMapDemoComponent.circularChartSelection) so a circular chart
// selection flows down through the normal Angular @Input/ngOnChanges path
// like any other config change, rather than the host reaching in and
// calling a component method directly through a @ViewChild/@ViewChildren
// reference.
export interface MapCircularChartSelection {
  selectedId: string | null;
  allIds: string[];
  slices?: { x: string; y: number; color?: string }[];
}

// Top-level collection config for NxMapCollectionComponent — each entry is
// its own independently-resolvable DataSource (inline/file/api), one
// <app-nx-map-demo> rendered per resolved entry, looping purely off this
// array's length/content. `T` is left generic here (rather than importing
// RawLayerNode, which lives in services/parent-config-transform.ts, a layer
// below this model file) — NxMapCollectionComponent itself pins it to
// RawLayerNode.
export interface MapCollectionConfig<T = any> {
  maps: DataSource<T>[];
}

export interface ClusterConfig extends ShapeStyle {
  allowClustering?: boolean;
  allowDeepClustering?: boolean;
  allowClusterExpand?: boolean;
  labelStyle?: LabelStyle;
}

export interface MarkerStyle extends ShapeStyle {
  labelStyle?: LabelStyle;
}

export interface ZoomConfig {
  enable: boolean;
  shouldZoomInitially: boolean;
  enablePanning: boolean;
  pinchZooming: boolean;
  mouseWheelZoom: boolean;
  showToolbarOnHover: boolean;
  toolbarSettings: {
    horizontalAlignment: string;
  };
}

export interface TitleConfig {
  text: string;
  titleStyle?: {
    // Syncfusion's TitleSettingsModel expects a CSS size string ("16px"),
    // not a bare number.
    size: string;
  };
}

export enum GraphicType {
  Marker = "marker",
  Line = "line",
  Polygon = "polygon",
  Circle = "circle",
}

export interface ParseTargetResult {
  type: GraphicType;
  index: number;
}

export enum MarkerShape {
  Balloon = "Balloon",
  Circle = "Circle",
  Diamond = "Diamond",
  Rectangle = "Rectangle",
  Triangle = "Triangle",
  Image = "Image",
  InvertedTriangle = "InvertedTriangle",
}

export const MAPS = {
  oman: "maps/oman.json",
  world: "maps/world.json",
  india: "maps/india.json",
  uae: "maps/uae.json",
};

export interface GraphicLookup {
  type: GraphicType;
  groupId: string;
  groupName?: string;
  object: MapObject;
}

// Syncfusion models

export interface MapOptions {
  titleSettings: TitleSettingsModel;
  zoomSettings: ZoomSettingsModel;
  layers: LayerSettingsModel[];
  // Root-level initial map center — only needed when the main layer has no
  // shapeData to auto-fit against (baseMapType: "osm"). See MapConfig.mapCenter.
  centerPosition?: GeoLocation;
}
