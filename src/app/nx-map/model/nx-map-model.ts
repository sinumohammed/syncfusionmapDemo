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

export interface MapTheme {
  marker?: MapThemeMarker;
  cluster?: MapThemeCluster;
  line?: MapThemeLine;
  polygon?: MapThemeFill;
  circle?: MapThemeFill;
  tooltip?: MapThemeTooltip;
  dataLabel?: MapThemeDataLabel;
}

// nx-map-themes.json's shape — a flat registry keyed by theme name.
export type MapThemeRegistry = Record<string, MapTheme>;

export interface MapConfig {
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
  // Marks this entry as the app's primary/base layer. At most one config
  // should set this; if none do, the builder/UI treat configs[0] as main.
  // The main layer's visibility can't be turned off from the layer panel —
  // hiding it would leave nothing for every other layer's groups/markers
  // to render against.
  isMainLayer?: boolean;
  // "shape" (default) renders this layer from `shapeData` (a GeoJSON
  // boundary, bound to markers/polygons via shapePropertyPath/name). "osm"
  // renders free OpenStreetMap street tiles instead — no shapeData, no
  // named-region binding for THIS layer, but groups/markers/polygons still
  // overlay on top of it normally.
  baseMapType?: "shape" | "osm";
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
