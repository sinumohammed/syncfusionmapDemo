// Model shared by nx-map (geo map), nx-image-map (picture base layer) and
// nx-circular-chart. The maps read the same host payload conventions and
// the same data-record / tooltip wire shapes, and all three use the same
// marker/swatch shape vocabulary (MarkerShape), so those live here once
// instead of as separate copies.
//
// Types plus the one MarkerShape enum — no other runtime code, no Syncfusion
// imports, and no imports from any component — so this folder can be copied
// next to nx-map/, nx-image-map/ and nx-circular-chart/ as-is (each imports
// it by relative path). Anything that genuinely differs (lat/long vs x/y
// points, each raw node's own Configuration[] type, etc.) stays in that
// component's own model file.

// Marker / legend-swatch shapes. String-valued, so a config's "Circle" IS
// MarkerShape.Circle — JSON configs keep using the plain names.
//  - nx-map: every value (Image = the point's imageUrl icon).
//  - nx-image-map: every value; Image, or any shape with an imageUrl, draws
//    the icon.
//  - nx-circular-chart: legend swatch shape (SeriesPaletteEntry.Shape), so a
//    category's swatch can echo that same category's marker on the map.
export enum MarkerShape {
  Balloon = "Balloon",
  Circle = "Circle",
  Diamond = "Diamond",
  Rectangle = "Rectangle",
  Triangle = "Triangle",
  Image = "Image",
  InvertedTriangle = "InvertedTriangle"
}

// A value that's either hardcoded inline, loaded from a static file, or
// fetched from a live API.
export interface DataSource<T> {
  source: "inline" | "file" | "api";
  value?: T; // required when source === "inline"
  url?: string; // required when source === "file" | "api" (HttpClient.get either way)
}

// One past reading in TooltipComponentEntry.History — oldest first. Value/
// Limit may arrive as numbers or numeric strings.
export interface TooltipHistoryPoint {
  Date?: string;
  Value?: string | number;
  Limit?: string | number;
}

// One metric reading inside a data record's Tooltip.ComponentList — one
// tile in the hover tooltip. PascalCase straight off the API.
export interface TooltipComponentEntry {
  Label?: string;
  Color?: string;
  // A number or a numeric string — both components coerce where they read it.
  Value?: string | number;
  Unit?: string;
  // This reading's own timestamp, shown under the tile's value, formatted
  // with TooltipFormat.DateFormat.
  Date?: string;
  // This reading's threshold — rendered as "value / Limit".
  Limit?: string | number;
  // Past readings for a trend sparkline. nx-map renders it (tile click ->
  // trend dock / maximize); nx-image-map accepts it but doesn't draw it yet.
  History?: TooltipHistoryPoint[];
}

// A data record's Tooltip block.
export interface MetricOverlayTooltip {
  // Per-marker tile-column override (else TooltipFormat.Columns).
  Columns?: number;
  ComponentList?: TooltipComponentEntry[];
  // Per-marker tile style override — a named layout (default, compact,
  // template2, nibras) — else TooltipFormat.Layout.
  Template?: string;
}

// The fields every data record shares, whichever map it feeds. Each
// component's own record type extends this with what only it understands
// (nx-map: Latitude/Longitude, Value2/3, Shape, ...; nx-image-map: Date).
export interface MarkerDataRecordBase {
  // Scopes the MarkerId match to the layer with this name; omit to match
  // a marker in any layer.
  LayerId?: string;
  // Joins this record to the marker point whose `id` equals it.
  MarkerId?: string;
  // The record's headline reading (the on-map label/value box) — Value may
  // be a number or a numeric string.
  Label?: string;
  Value?: string | number;
  Unit?: string;
  // Status color — also recolors the marker.
  Color?: string;
  // The full multi-metric hover-tooltip snapshot.
  Tooltip?: MetricOverlayTooltip;
}

// RawMapNodeBase.TooltipFormat, parsed from its JSON string — app-wide
// hover-tooltip defaults.
export interface RawTooltipFormat {
  Columns?: number;
  // Named tile style: default | compact | template2 | nibras.
  Layout?: string;
  // yyyy / MMM / MM / dd / HH / hh / mm / ss / a tokens.
  DateFormat?: string;
}

// RawTooltipFormat after the transform — camelCase, as each component's
// resolved config carries it.
export interface TooltipFormatConfig {
  columns?: number;
  layout?: string;
  dateFormat?: string;
}

// The host payload fields both map nodes read, with the same meaning:
// structured settings arrive as JSON-encoded strings, name lists as comma-
// separated strings. Each component's own node type extends this (and adds
// its own Configuration[] type and flags).
export interface RawMapNodeBase {
  ComponentType?: number;
  // JSON string — the map's own settings (base shape/image, title, zoom, ...).
  MainLayerSettings?: string | null;
  // "MOL,AlWusta" — each name resolves to <layers folder>/<slug>.json.
  LayerFileLists?: string | null;
  // URL returning an array of layer files.
  LayerAPIURL?: string | null;
  // JSON string of an array of layer files.
  LayerInlineJSON?: string | null;
  // Only these layers start checked in the layer filter.
  LayersDefaultSelected?: string | null;
  // Data records (MarkerDataRecordBase-shaped) for the markers.
  DataAPIURL?: string | null;
  // JSON string -> RawTooltipFormat.
  TooltipFormat?: string | null;
}
