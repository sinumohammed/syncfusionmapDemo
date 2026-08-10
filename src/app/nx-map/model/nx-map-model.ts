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
  // Donut-metric readings keyed by donut id (tvp/salt/bsw/h2s/api/flow/
  // other) — shown in full on hover (see toMarker()'s m_<key>/c_<key>
  // fields) and used by NxMapDemoComponent.applyDonutSelection() to decide
  // which color a persistent label gets when that metric's donut is
  // clicked (see MapGroup.activeMetricId).
  metrics?: Record<string, PointMetric>;
}

export interface PointMetric {
  value: number;
  unit?: string;
  // "high" gets the clicked metric's own highlight color on the map
  // (NXMapBuilderService.METRIC_COLORS); "normal" gets a shared neutral
  // label color. Map coloring only ever looks at THIS field — see
  // impact's own comment for what actually drives a donut's two slices.
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
}

// One tile in the hover tooltip's metric grid — `metricId` must be one of
// NXMapBuilderService.METRIC_KEYS (tvp/salt/bsw/h2s/api/flow/other), the
// only ids toMarker() actually computes template fields for. `title` is
// the tile's own small label (e.g. "TVP", "BS&W") — defaults to
// metricId.toUpperCase() if omitted.
export interface TooltipTemplateItem {
  metricId: string;
  title?: string;
}

// Drives the hover tooltip's whole layout — `columns` tiles per row,
// `items` in display order (wraps to a new row every `columns` items).
// Set on the MAIN layer's MapConfig (MapConfig.tooltipTemplate); omit to
// fall back to NXMapBuilderService.DEFAULT_TOOLTIP_TEMPLATE. There's
// exactly one tooltip template live at a time app-wide (see
// NxMapDemoComponent.injectMarkerTooltipTemplate()'s own comment) — with
// NxMapCollectionComponent looping over several maps, whichever map's
// config resolves first wins for all of them.
export interface TooltipTemplateConfig {
  columns: number;
  items: TooltipTemplateItem[];
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
  // Default unset/null. When set to a metric id (tvp/salt/bsw/h2s/api/
  // flow/other), every marker in this group ADDITIONALLY renders a
  // persistent label overlay (on top of its normal shape+color+cluster
  // rendering, which is unaffected) showing that metric's own value — see
  // buildMarkerPoints() in nx-map-builder.service.ts. Each point's label
  // color is METRIC_COLORS[activeMetricId] when that point's reading's
  // status is "high", NORMAL_LABEL_COLOR otherwise. Hover tooltip behavior
  // is unaffected either way (always reads point.metrics, never this).
  // Set by NxMapDemoComponent.applyDonutSelection() when an external panel
  // (e.g. a donut/category chart) selects a metric — cleared (null) again
  // once nothing is selected.
  activeMetricId?: string | null;
  // The freshly-fetched per-point values for activeMetricId — see
  // NXMapConfigService.loadMarkerValues() and applyDonutSelection()'s own
  // comment. Keyed by point id (MapPoint.id via BaseMapObject), same shape
  // as one entry of MapPoint.metrics. toMetricOverlayMarker() in
  // nx-map-builder.service.ts reads THIS (not point.metrics) for the
  // overlay label/color whenever it's present — falling back to
  // point.metrics[activeMetricId] only if a fetch hasn't populated this
  // yet, so the overlay never has a blank flash while the "API" call for a
  // freshly-clicked metric is in flight and point.metrics already has last
  // load's data. Unset/null clears back to that fallback.
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
  // has one). `color` here overrides METRIC_COLORS[activeMetricId] the same
  // way; omit either field to keep that level's own default. Unset/absent
  // on this group entirely (the common case today) falls through to
  // defaults for every point.
  impactMarkerStyle?: Partial<Record<"customer" | "non-customer", { shape?: string; color?: string }>>;
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
  baseMapType?: "shape" | "osm" | "satellite";
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

export interface MapState {
  groups: MapGroup[];
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
