// NxImageMapComponent's own working state — never part of the host config,
// layer files, data records or events (those are the public contract in
// nx-image-map-model.ts). Nothing outside nx-image-map/ should import from
// here, so these shapes can change freely without affecting hosts.
import {
  ImageMapDataRecord,
  ImageMapLabelPosition,
  ImageMapLayerFile,
  ImageMapTooltipEntry,
  ImageMapValueDisplay
} from "./nx-image-map-model";
import { MarkerShape } from "../../nx-map-common/nx-map-common.model";

// One point from a layer file with its style fully resolved (point ->
// group style -> config.markerStyle -> DEFAULT_MARKER) and its data joined.
export interface ResolvedMarker {
  key: string;
  id: string;
  name: string;
  layerName: string;
  groupId: string;
  groupName: string;
  x: number;
  y: number;
  shape: MarkerShape;
  color: string;
  width: number;
  height: number;
  borderColor: string;
  borderWidth: number;
  imageUrl?: string;
  labelColor?: string;
  valueDisplay: ImageMapValueDisplay;
  labelPosition: ImageMapLabelPosition;
  records: ImageMapDataRecord[];
  // Tooltip tiles — the records' Tooltip.ComponentList entries when any
  // were sent, otherwise one tile per record (Label/Value/Unit/Color/Date).
  tiles: ImageMapTooltipEntry[];
  tooltipColumns: number;
  // Per-marker tile style (a record's Tooltip.Template), else TooltipFormat.Layout.
  tooltipLayout?: string;
}

// One location-picker click, in image-pixel coordinates.
export interface PickedPoint {
  id: string;
  x: number;
  y: number;
}

// The result of resolving one layer source — the layer file, or why it failed.
export interface LoadedLayer {
  source: string;
  file?: ImageMapLayerFile;
  error?: string;
}

// Layer filter tree: Layer -> Group -> Marker. Checked state lives only on
// the markers (the component's checkedKeys); a group's/layer's state is
// derived from them.
export interface FilterMarkerNode {
  key: string;
  name: string;
}
export interface FilterGroupNode {
  key: string;
  name: string;
  markers: FilterMarkerNode[];
}
export interface FilterLayerNode {
  key: string;
  name: string;
  groups: FilterGroupNode[];
}
export type CheckState = "all" | "none" | "some";
