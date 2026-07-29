import { DataSource, MapConfig } from "./nx-map-model";

// One "hardcoded" layer (own geography/shapeData, e.g. a governorate
// boundary) that the app always loads, distinct from the API-driven
// sub-layer groups below (which share the base layer's geography).
export interface StaticLayerRef {
  // No separate layerName field — same reasoning as NXMapAppConfig dropping
  // baseLayerName below: this layer's name is only ever known once
  // configSource actually resolves (its own `layerName`), whether that's an
  // immediate JSON.parse for "inline" or a real fetch for "file"/"api" — so
  // there's nothing to put here that wouldn't risk drifting from the real
  // value. Callers that need this layer's name before configSource
  // resolves (e.g. shapeDataSource's registry-fallback lookup) resolve
  // configSource first and use ITS layerName — see
  // nx-map-demo.component.ts's ngOnInit().
  configSource: DataSource<MapConfig>;
  // Omit to fall back to SHAPE_DATA_BY_LAYER_NAME (shape-data-registry.ts),
  // looked up by this layer's resolved layerName — see
  // NXMapConfigService.resolveShapeData(). Set this explicitly whenever a
  // deployment's shape data lives somewhere the bundled registry doesn't
  // cover; it always wins over the registry when present.
  shapeDataSource?: DataSource<any>;
  // This layer's OWN sub-layer API(s) — same mechanism as
  // NXMapAppConfig.subLayerApis, but merged into THIS layer's own groups[]
  // instead of the base layer's. A layer with none just keeps whatever
  // groups its own configSource already defines, unchanged.
  subLayerApis?: SubLayerApiConfig[];
  // Overrides whatever theme this layer's own resolved config set (if any)
  // — same override-wins-over-resolved-value precedence as
  // parentLayerName/participateInFilter below. Omit to just keep the
  // config's own MapConfig.theme (which itself may be unset, falling
  // through to NXMapAppConfig.theme, then "default").
  theme?: string;
  // Defaults to the base layer's own layerName (resolved from
  // baseLayerConfigSource, NOT a separate app-config field — see
  // NXMapAppConfig below) — nests this layer under the base layer in the
  // filter tree (see MapConfig.parentLayerName).
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
  // No separate baseLayerName field — the base layer's name is whatever
  // baseLayerConfigSource resolves to (its own `layerName`), same as any
  // other layer. Keeping a second, independently-set name here would be a
  // value a caller has to remember to keep in sync with the config's own
  // layerName, with no enforcement if it ever drifted (e.g. the shapeData
  // registry lookup below would silently key against the wrong name).
  baseLayerConfigSource: DataSource<MapConfig>;
  // Same property name/shape as StaticLayerRef.shapeDataSource — the base
  // layer is "one level up" from staticLayers, not a structurally different
  // kind of layer. Omit to fall back to SHAPE_DATA_BY_LAYER_NAME, looked up
  // by the base layer's own resolved layerName.
  shapeDataSource?: DataSource<any>;
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
