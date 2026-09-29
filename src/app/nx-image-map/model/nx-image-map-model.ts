// nx-image-map: a picture (plant schematic, vessel layout, ...) as the one
// base layer, with marker layers placed on it by plain image-pixel x/y —
// no lat/long, no projection, no Syncfusion. The wire shapes it has in
// common with nx-map (DataSource, data records, tooltip entries, tooltip
// format, raw host-node fields) come from ../../nx-map-common — the
// ImageMap* names below are aliases/extensions of those so this component's
// own code reads the same as before.
import { MarkerShape } from "../../nx-map-common/nx-map-common.model";
import type {
  DataSource,
  MarkerDataRecordBase,
  RawMapNodeBase,
  TooltipComponentEntry,
  TooltipFormatConfig
} from "../../nx-map-common/nx-map-common.model";

// Same three interchangeable sources as nx-map — the shared DataSource<T>.
export type ImageMapDataSource<T> = DataSource<T>;

// "hover"  — values only in the hover tooltip (default)
// "always" — a value box stays next to the marker, no hover tooltip
// "both"   — value box always shown AND the full tooltip on hover
export type ImageMapValueDisplay = "hover" | "always" | "both";

export type ImageMapLabelPosition = "right" | "left" | "top" | "bottom";


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
export type ImageMapTooltipFormat = TooltipFormatConfig;

// Query params for DataAPIURL — whatever the host page has selected (date,
// asset, ...). null/undefined/"" values are left off the request.
export type ImageMapParams = Record<string, string | number | boolean | null | undefined>;

// The host's raw payload, same field conventions as nx-map's RawLayerNode
// (JSON-encoded strings for structured settings, comma-separated name
// lists). Only the fields read here are typed; every other generic widget
// field (Columns, Rows, Icon, ...) is ignored.
//
// MainLayerSettings (-> ImageMapMainLayerSettings), LayerFileLists
// ("Bunkering,Fuel Efficiency" -> assets/nx-image-map/layers/<slug>.json),
// LayerAPIURL / LayerInlineJSON (ImageMapLayerFile[]), LayersDefaultSelected,
// DataAPIURL and TooltipFormat come from the shared RawMapNodeBase.
export interface RawImageMapNode extends RawMapNodeBase {
  Id?: number;
  ElementName?: string | null;
  LoadDataOnStart?: boolean | null;
  // nx-map's name for the same flag — accepted as an alias.
  LoadMetricOnStart?: boolean | null;
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
  shape?: MarkerShape;
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
export interface ImageMapDataRecord extends MarkerDataRecordBase {
  // Tolerated lowercase alias of MarkerId.
  markerId?: string;
  // The headline reading's own timestamp (tooltip tile fallback when the
  // record has no Tooltip.ComponentList).
  Date?: string;
}

// One tooltip tile's reading — the shared TooltipComponentEntry.
export type ImageMapTooltipEntry = TooltipComponentEntry;

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
