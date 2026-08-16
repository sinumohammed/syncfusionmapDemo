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
  // reading for, keyed by metric id ("tvp", "bsw", whatever a
  // MetricOverlayRecord.tooltip happens to carry). Set by
  // NxMapDemoComponent.applyMetricSelection() from a matched record's own
  // `tooltip` map — NOT by activeMetricId/activeMetricValues (that's still
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
  // Set from MetricOverlayRecord.tooltip's own reserved "columns" key
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
  // MetricOverlayRecord.tooltip's own reserved "template" key (see its
  // own comment). Read by NXMapBuilderService.toMarker() into this
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
}

export interface PointMetric {
  value: number;
  unit?: string;
  // "high" gets this reading's own `color` below (falling back to a
  // shared neutral label color when `color` is omitted); "normal" always
  // gets the shared neutral color regardless of `color`. Map coloring only
  // ever looks at THIS field — see impact's own comment for what actually
  // drives a donut's two slices.
  status: "high" | "normal";
  // Only meaningful when status is "high" — which of a donut's two slices
  // this reading counts toward ("Customer impact" vs "Non-customer
  // impact" in nx-donut-charts.json). The donut's total is the count of
  // "high" readings ONLY, split by this field — "normal" readings aren't
  // counted on the donut at all, even though they still render on the map
  // (labeled, in the neutral color) once that metric is selected. Unset on
  // a "normal" reading — nothing reads it in that case.
  impact?: "customer" | "non-customer";
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
  // meaningful on an entry inside MetricOverlayRecord.tooltip (ignored
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
  // This reading's own highlight color when status is "high" — straight
  // from the data, no hardcoded per-metric-id palette anywhere in code
  // (NXMapBuilderService no longer has a METRIC_COLORS lookup). Read by
  // toMarker() for the hover tooltip tile's value color, and by
  // toMetricOverlayMarker() (via a matched record's own top-level color,
  // MetricOverlayRecord also being a PointMetric) for the on-map overlay
  // label color once that metric's donut is clicked. Omit to fall back to
  // the shared neutral label color, same as a "normal" reading always
  // gets regardless of this field.
  color?: string;
}

// One entry in the response NXMapConfigService.loadMetricOverlay() fetches
// on a donut click (NXMapAppConfig.metricDataApiUrl) — a PointMetric reading
// plus enough to find (or create) the marker it belongs on. Matched by
// NxMapDemoComponent's own algorithm (see applyDonutSelectionChange()):
// `markerId` resolving to an existing point (scoped to `layerId`'s own
// layer when given, or matched against every layer when omitted) anchors
// the reading to that point, exactly like MapGroup.activeMetricValues
// already does; a `markerId` that doesn't resolve but carries its own
// `latitude`/`longitude` instead plots as a brand-new point (on `layerId`'s
// own layer when that resolves, otherwise the main layer), using `id` (or
// `markerId` if `id` is omitted, or an auto-generated one if both are) as
// THIS new point's own MapPoint.id; neither markerId/latitude+longitude is
// a console.error + on-screen toast, that record skipped. A deployment's
// own backend decides how it computes/attributes each reading — this map
// only ever cares about these six extra fields on top of the reading
// itself.
export interface MetricOverlayRecord extends PointMetric, ShapeStyle {
  layerId?: string;
  markerId?: string;
  // Only meaningful for a brand-new (unanchored) point — its own identity,
  // independent of `markerId` (which always means "match this EXISTING
  // marker", whether or not that match actually resolves). Omit to fall
  // back to `markerId` (even an unresolved one) or, failing that, an
  // auto-generated id.
  id?: string;
  latitude?: number;
  longitude?: number;
  name?: string;
  // shape/color/width/height (via ShapeStyle) are only meaningful for a
  // brand-new (unanchored) point too — forwarded straight onto that point's
  // own MapPoint fields in NxMapDemoComponent.applyMetricSelection(), which
  // already take precedence over the ad hoc group's own style/theme (see
  // NXMapBuilderService.toMarker()'s point -> groupStyle -> theme
  // resolution order). Omit any/all to just inherit the ad hoc group's own
  // theme (METRIC_OVERLAY_GROUP_ID's `theme`, see its own comment) like
  // every other ad hoc point.

  // The FULL multi-metric snapshot for this point's always-on hover
  // tooltip — independent of which single metric this record's own
  // value/status/impact/markerId are actually about (that trio still only
  // ever drives the ONE selected metric's on-map overlay label/color,
  // exactly as before this field existed). Keyed by metric id — whatever
  // keys show up here are exactly what NXMapBuilderService.toMarker()
  // populates real values for on this point (see MapPoint.tooltipMetrics'
  // own comment); a metric id absent here just leaves that tile's
  // placeholder in place. Forwarded onto the matched (or brand-new)
  // point's own tooltipMetrics in NxMapDemoComponent.applyMetricSelection()
  // — omit entirely to leave the point's tooltip untouched by this record.
  //
  // Two reserved keys, neither a PointMetric reading:
  // - "columns" (a plain number) — how many tiles per row THIS record's
  //   own point's tooltip renders. PER-POINT, not global: forwarded onto
  //   just the ONE point this record matches (or creates) as
  //   MapPoint.tooltipColumns — every other point keeps using the
  //   map-wide default (a static layer's own MapConfig.
  //   tooltipTemplate.columns when set, otherwise
  //   NXMapBuilderService.DEFAULT_TOOLTIP_TEMPLATE.columns).
  // - "template" (a plain string) — this point's own tile STYLE variant
  //   (e.g. "compact"), forwarded as MapPoint.tooltipLayout. Applied as a
  //   CSS class (`mtt-layout-<name>`) on this marker's own tooltip
  //   instance, substituted per-marker exactly like "columns" is — see
  //   MapPoint.tooltipLayout's own comment for why this only works for
  //   layouts that are CSS-only variations of the SAME tile markup, not
  //   a different HTML structure per tile (that's what
  //   TooltipTemplateConfig.layout / NxMapDemoComponent.
  //   TOOLTIP_TILE_LAYOUTS is for instead — a config-level, not per-point,
  //   choice). Falls back to the static config's own `layout`, then
  //   "default".
  // Both: set on every record that actually wants an override for its
  // own point; omit either (the common case) to leave that point on the
  // relevant default.
  tooltip?: Record<string, PointMetric | number | string>;
}

// One tile in the hover tooltip's metric grid — `metricId` can be any
// string. This full item list is never required to be authored by hand:
// NxMapDemoComponent.deriveTooltipTemplate() auto-builds one entry per
// distinct key found across a fetch's own MetricOverlayRecord.tooltip
// maps (title from that metric's own PointMetric.label, or metricId
// itself uppercased) — a config's own MapConfig.tooltipTemplate.items
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
  style?: ShapeStyle;
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
  // NxMapDemoComponent.donutSelection when an external panel (e.g. a
  // donut/category chart) selects a metric — cleared (null) again once
  // nothing is selected.
  activeMetricId?: string | null;
  // The freshly-fetched per-point values for activeMetricId — see
  // NXMapConfigService.loadMetricOverlay() and
  // NxMapDemoComponent.applyDonutSelectionChange()'s own comment. Keyed by
  // point id (MapPoint.id via BaseMapObject, or a synthesized id for a
  // brand-new unanchored point). toMetricOverlayMarker() in
  // nx-map-builder.service.ts reads this for the overlay label/color — a
  // point with no entry here (activeMetricId set, but this map has nothing
  // for that point id) renders with no overlay at all, same as a point
  // with no reading. Unset/null (no selection) clears every overlay.
  activeMetricValues?: Record<string, PointMetric> | null;
  // Optional per-impact icon override for a "high" reading's donut-click
  // overlay marker (see toMetricOverlayMarker() in
  // nx-map-builder.service.ts) — lets a deployment's own config JSON
  // differentiate "customer impact" from "non-customer impact" by SHAPE as
  // well as color, e.g. `{ customer: { shape: "Diamond" }, "non-customer":
  // { shape: "Triangle" } }`. Resolution per point, most specific wins:
  // this group's own impactMarkerStyle[reading.impact] entry, then
  // NXMapBuilderService.DEFAULT_IMPACT_SHAPES for that impact value, then a
  // plain circle if impact itself is unset (a "normal"-status reading never
  // has one). `color` here overrides that reading's own PointMetric.color
  // the same way; omit either field to keep that level's own default. Unset/absent
  // on this group entirely (the common case today) falls through to
  // defaults for every point.
  impactMarkerStyle?: Partial<Record<"customer" | "non-customer", { shape?: string; color?: string }>>;
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

// Mirrors DonutSelectionEvent (nx-donut-model.ts) in shape — same
// independent-shape-mirroring convention as MapCollectionConfig/
// DonutCollectionConfig above, so nx-map still shares nothing with nx-donut
// at the type level. Bound as an @Input on NxMapCollectionComponent/
// NxMapDemoComponent (see NxMapDemoComponent.donutSelection) so a donut
// selection flows down through the normal Angular @Input/ngOnChanges path
// like any other config change, rather than the host reaching in and
// calling a component method directly through a @ViewChild/@ViewChildren
// reference.
export interface MapDonutSelection {
  selectedId: string | null;
  allIds: string[];
  slices?: { x: string; y: number; color?: string }[];
}

// Top-level collection config for NxMapCollectionComponent — mirrors
// DonutCollectionConfig (nx-donut-model.ts) in shape: each entry is its own
// independently-resolvable DataSource (inline/file/api), one
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
  imageUrl?: string;
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
