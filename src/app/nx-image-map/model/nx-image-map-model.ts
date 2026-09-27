// nx-image-map: a picture (plant schematic, vessel layout, ...) as the one
// base layer, with marker layers placed on it by plain image-pixel x/y —
// no lat/long, no projection, no Syncfusion. Deliberately shares nothing
// with nx-map at the type level (same independent-copy convention
// nx-circular-chart follows): the shapes below mirror nx-map's where it
// helps authoring (mol.json-style layer files, MetricOverlayRecord-style
// data records) but are their own declarations.

// Same three interchangeable sources nx-map's own DataSource<T> offers.
export interface ImageMapDataSource<T> {
  source: "inline" | "file" | "api";
  value?: T; // required when source === "inline"
  url?: string; // required when source === "file" | "api"
}

// "hover"  — values only in the hover tooltip (default)
// "always" — a value box stays next to the marker, no hover tooltip
// "both"   — value box always shown AND the full tooltip on hover
export type ImageMapValueDisplay = "hover" | "always" | "both";

export type ImageMapLabelPosition = "right" | "left" | "top" | "bottom";

export type ImageMapMarkerShape = "Circle" | "Rectangle" | "Triangle" | "Diamond" | "Balloon";

export interface ImageMapZoomConfig {
  // "auto" enables zoom/pan only when the image's real (natural) resolution
  // exceeds autoThresholdPx on either side — a small picture gains nothing
  // from zooming, so its zoom controls render disabled instead.
  // "on"/"off" force it regardless of resolution.
  mode?: "auto" | "on" | "off";
  autoThresholdPx?: number; // default 1200
  maxZoom?: number; // default 8
  step?: number; // zoom factor per button click / wheel notch, default 1.5
}

// How the picture fits its area:
//  "auto" (default) — "fill" when that stretches the picture by at most
//                     autoFitMaxStretch (default 0.15 = 15%), else "contain"
//  "fill"    — exactly the widget's width and height: no gaps, no cropping,
//              the picture stretches (markers still line up — x and y
//              scale independently)
//  "contain" — keeps the aspect ratio, leaving gaps on two sides
//  "cover"   — keeps the aspect ratio and crops whatever overflows
export type ImageMapImageFit = "auto" | "fill" | "contain" | "cover";

export interface ImageMapBaseImage {
  url: string;
  // The coordinate space every point's x/y is authored in. Omit both to use
  // the image's own natural pixel size. Keep them fixed once points are
  // authored: a higher-resolution copy of the same picture can then be
  // swapped in without touching a single point.
  width?: number;
  height?: number;
}

// What NxImageMapComponent renders from — produced from the host's raw
// node (RawImageMapNode, below) by image-map-parent-config-transform.ts;
// never authored as its own file.
export interface ImageMapConfig {
  layerName?: string;
  title?: string;
  baseImage: ImageMapBaseImage;
  valueDisplay?: ImageMapValueDisplay; // default "hover"
  labelPosition?: ImageMapLabelPosition; // default "right"
  zoom?: ImageMapZoomConfig;
  imageFit?: ImageMapImageFit; // default "auto"
  autoFitMaxStretch?: number; // "auto" only — default 0.15
  // The 📍 toolbar button — click the image, get its x/y as a ready-to-paste
  // point line. Default true; set false for production dashboards.
  showLocationPicker?: boolean;
  // Fallback marker style under every group's own markerConfig.style.
  markerStyle?: ImageMapMarkerStyle;
  // A plain string is shorthand for { source: "file", url: <string> }.
  // Each source resolves to ONE layer file (LayerFileLists) or an ARRAY of
  // them (LayerAPIURL/LayerInlineJSON) — both are flattened.
  layers: (string | ImageMapDataSource<ImageMapLayerFile | ImageMapLayerFile[]>)[];
  // LayersDefaultSelected — only these layers (matched against each layer
  // file's own layerName, case/spacing-insensitive) start checked in the
  // filter; the rest are listed but unchecked. Unset -> every layer starts
  // checked (except groups with visible: false).
  defaultSelectedLayerNames?: string[];
  // DataAPIURL — fetched with NxImageMapComponent's `params` @Input as query
  // params whenever they change; once on load with no params when
  // loadDataOnStart is true (and no params are set yet).
  dataApiUrl?: string;
  loadDataOnStart?: boolean;
  tooltip?: ImageMapTooltipFormat;
  // Anything the transform couldn't make sense of (e.g. malformed
  // MainLayerSettings JSON) — surfaced in the component's problems panel.
  configProblems?: string[];
}

// RawImageMapNode.TooltipFormat, parsed — same fields/meaning as nx-map's
// RawTooltipFormat. `layout` names a tile style (default/compact/template2/
// nibras — same names nx-map uses); `dateFormat` uses the same
// yyyy/MMM/MM/dd/HH/hh/mm/ss/a tokens.
export interface ImageMapTooltipFormat {
  columns?: number;
  layout?: string;
  dateFormat?: string;
}

// Query params for DataAPIURL — whatever the host page has selected (date,
// asset, ...). null/undefined/"" values are left off the request.
export type ImageMapParams = Record<string, string | number | boolean | null | undefined>;

// The host's raw payload, same field conventions as nx-map's RawLayerNode
// (JSON-encoded strings for structured settings, comma-separated name
// lists). Only the fields read here are typed; every other generic widget
// field (Columns, Rows, Icon, ...) is ignored.
export interface RawImageMapNode {
  ComponentType?: number;
  Id?: number;
  ElementName?: string | null;
  // JSON string -> ImageMapMainLayerSettings.
  MainLayerSettings?: string | null;
  // "Bunkering,Fuel Efficiency" -> assets/nx-image-map/layers/<slug>.json each.
  LayerFileLists?: string | null;
  // URL returning ImageMapLayerFile[].
  LayerAPIURL?: string | null;
  // JSON string of ImageMapLayerFile[].
  LayerInlineJSON?: string | null;
  LayersDefaultSelected?: string | null;
  DataAPIURL?: string | null;
  LoadDataOnStart?: boolean | null;
  // nx-map's name for the same flag — accepted as an alias.
  LoadMetricOnStart?: boolean | null;
  // JSON string: { Columns, Layout, DateFormat }.
  TooltipFormat?: string | null;
  // Collection node (ComponentType 7125) only — one image map per entry.
  Configuration?: RawImageMapNode[] | null;
}

// MainLayerSettings, parsed. Names follow nx-map's own MainLayerSettings
// where one exists (title.text, coordinatePickerEnabled).
export interface ImageMapMainLayerSettings {
  layerName?: string;
  title?: { text?: string };
  baseImage: ImageMapBaseImage;
  valueDisplay?: ImageMapValueDisplay;
  labelPosition?: ImageMapLabelPosition;
  zoom?: ImageMapZoomConfig;
  imageFit?: ImageMapImageFit;
  autoFitMaxStretch?: number;
  coordinatePickerEnabled?: boolean;
  markerStyle?: ImageMapMarkerStyle;
}

export interface ImageMapBorder {
  color?: string;
  width?: number;
}

export interface ImageMapMarkerStyle {
  shape?: ImageMapMarkerShape;
  color?: string;
  width?: number;
  height?: number;
  border?: ImageMapBorder;
  imageUrl?: string;
  labelStyle?: { color?: string };
}

// mol.json-shaped layer file — only x/y instead of latitude/longitude.
export interface ImageMapLayerFile {
  layerConfig: ImageMapLayerConfig;
}

export interface ImageMapLayerConfig {
  layerName: string;
  valueDisplay?: ImageMapValueDisplay;
  groups: ImageMapGroup[];
}

export interface ImageMapGroup {
  id: string;
  name?: string;
  visible?: boolean; // default true
  valueDisplay?: ImageMapValueDisplay;
  labelPosition?: ImageMapLabelPosition;
  markerConfig: {
    style?: ImageMapMarkerStyle;
    points: ImageMapPoint[];
  };
}

export interface ImageMapPoint extends ImageMapMarkerStyle {
  // The join key — a data record's MarkerId lands on the point with this id.
  id: string;
  x: number;
  y: number;
  name?: string;
  valueDisplay?: ImageMapValueDisplay;
  labelPosition?: ImageMapLabelPosition;
}

// One reading for one marker — the same PascalCase wire shape as nx-map's
// MetricOverlayRecord (MarkerId/Value/Unit/Color/Tooltip.ComponentList), so
// one backend payload can feed either control. Several records may share a
// MarkerId; each becomes its own line in that marker's value box/tooltip.
export interface ImageMapDataRecord {
  // Optional — scopes the MarkerId match to the layer with this layerName
  // (same as nx-map's MetricOverlayRecord.LayerId); omit to match any layer.
  LayerId?: string;
  MarkerId?: string;
  markerId?: string; // tolerated lowercase alias
  Label?: string;
  Value?: string | number;
  Unit?: string;
  Color?: string; // also recolors the marker itself (first record wins)
  Date?: string;
  Tooltip?: {
    Columns?: number;
    ComponentList?: ImageMapTooltipEntry[];
    // Per-marker tile style override — same as nx-map's
    // MetricOverlayTooltip.Template.
    Template?: string;
  };
}

export interface ImageMapTooltipEntry {
  Label?: string;
  Value?: string | number;
  Unit?: string;
  Color?: string;
  Date?: string;
  Limit?: string | number;
}

// Emitted by NxImageMapComponent.markerClick.
export interface ImageMapMarkerClickEvent {
  id: string;
  name: string;
  layerName: string;
  groupId: string;
  x: number;
  y: number;
  records: ImageMapDataRecord[];
}
