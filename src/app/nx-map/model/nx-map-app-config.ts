import { DataSource, MapConfig } from "./nx-map-model";

// One "hardcoded" layer (own geography/shapeData, e.g. a governorate
// boundary) that the app always loads, distinct from the API-driven
// sub-layer groups below (which share the base layer's geography).
export interface StaticLayerRef {
  layerName: string;
  configSource: DataSource<MapConfig>;
  // Omit to fall back to SHAPE_DATA_BY_LAYER_NAME (shape-data-registry.ts),
  // looked up by this layerName — see
  // NXMapConfigService.resolveShapeData(). Set this explicitly whenever a
  // deployment's shape data lives somewhere the bundled registry doesn't
  // cover; it always wins over the registry when present.
  shapeDataSource?: DataSource<any>;
  // Defaults to the app config's baseLayerName — nests this layer under the
  // base layer in the filter tree (see MapConfig.parentLayerName).
  parentLayerName?: string;
  // Defaults to true — set false to keep this layer on the map but hide it
  // from the filter popup entirely (see MapConfig.participateInFilter).
  participateInFilter?: boolean;
}

// Purely configuration — no data. The MapGroup[] content for a sub-layer
// arrives only at runtime from the API call itself, and gets merged into
// the base layer's groups[] (same geography, no separate shapeData).
export interface SubLayerApiConfig {
  url: string;
  // Default heading applied to any group from this endpoint that doesn't
  // set its own `heading` — buckets it under a toggleable heading node in
  // the filter tree.
  heading?: string;
}

// Top-level, deployment-swappable description of where every piece of map
// data comes from. `pdo-map-config.json` is an instance of this shape.
export interface NXMapAppConfig {
  baseLayerName: string;
  baseLayerConfigSource: DataSource<MapConfig>;
  // Omit to fall back to SHAPE_DATA_BY_LAYER_NAME, looked up by
  // baseLayerName — same rule as StaticLayerRef.shapeDataSource above.
  baseShapeDataSource?: DataSource<any>;
  staticLayers: StaticLayerRef[];
  subLayerApis: SubLayerApiConfig[];
  // App-wide default theme (a name into nx-map-themes.json) — every layer
  // inherits this unless it sets its own MapConfig.theme, which wins. Set
  // this ONCE here instead of repeating the same theme on every layer's own
  // config; a sub-layer API group also inherits it through whichever layer
  // it gets merged into, so its own groups don't need a `theme` field
  // either unless a specific group needs to override it individually (see
  // MapGroup.theme).
  theme?: string;
}
