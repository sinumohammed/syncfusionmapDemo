import { NXMapAppConfig, StaticLayerRef, SubLayerApiConfig } from "../model/nx-map-app-config";
import { DataSource } from "../model/nx-map-model";

// Real upstream shape — one node per layer (the root = base layer, each
// entry in `Configuration` = a static layer). Deliberately typed loosely
// (only the fields this transform actually reads) — a real node carries many
// other unrelated properties (Columns, Icon, WidgetId, ...), all ignored
// here. `Configuration` is only ever populated on the root in practice, but
// typed as recursive/nullable to match what the raw payload allows.
export interface RawLayerNode {
  // 0 = inline (parse LayerConfigJSON), 1 = file, 2 = api (fetch
  // LayerConfigURL either way).
  LayerConfigSource: 0 | 1 | 2;
  LayerConfigJSON: string | null;
  LayerConfigURL: string | null;
  // Same 0/1/2 meaning as LayerConfigSource, but for this layer's
  // shape/boundary geometry instead of its group/marker config.
  ShapeDataSource: 0 | 1 | 2;
  ShapeDataJSON: string | null;
  ShapeDataURL: string | null;
  // This layer's own sub-layer API endpoint (a bare URL, unlike
  // NXMapAppConfig.subLayerApis'/StaticLayerRef.subLayerApis' richer
  // {url, heading}[] shape) — null/absent means this layer's groups stay
  // exactly as its own LayerConfigJSON/LayerConfigURL defines them.
  SubLayersAPI?: string | null;
  // Overrides whatever theme this layer's own resolved config sets (see
  // StaticLayerRef.theme/buildAppConfig() below) — null/absent keeps the
  // config's own theme (which may itself be unset).
  Theme?: string | null;
  Configuration?: RawLayerNode[] | null;
}

// "1" -> "file", "2" -> "api" — 0 (inline) is handled separately since it
// needs LayerConfigJSON/ShapeDataJSON parsed, not a URL.
function fileOrApi(source: 1 | 2): "file" | "api" {
  return source === 1 ? "file" : "api";
}

// A node's LayerConfigSource/LayerConfigJSON/LayerConfigURL -> DataSource<MapConfig>.
// Always resolvable (LayerConfigJSON is expected whenever LayerConfigSource
// is 0) — unlike shapeDataSourceOf below, there's no "fall back to a
// registry" concept for layer CONFIG, only for shape data.
function configSourceOf(node: RawLayerNode): DataSource<any> {
  if (node.LayerConfigSource === 0) {
    return { source: "inline", value: JSON.parse(node.LayerConfigJSON as string) };
  }
  return { source: fileOrApi(node.LayerConfigSource), url: node.LayerConfigURL as string };
}

// A node's ShapeDataSource/ShapeDataJSON/ShapeDataURL -> DataSource<any>, or
// undefined when nothing USABLE was actually supplied — e.g. ShapeDataSource
// claims "file" (1) but ShapeDataURL is null, which happens throughout the
// real payload. Returning undefined here (rather than a DataSource with a
// null url) is what lets NXMapConfigService.resolveShapeData() fall through
// to the bundled shape-data-registry.ts fallback, keyed by this layer's own
// resolved layerName.
function shapeDataSourceOf(node: RawLayerNode): DataSource<any> | undefined {
  if (node.ShapeDataSource === 0) {
    return node.ShapeDataJSON ? { source: "inline", value: JSON.parse(node.ShapeDataJSON) } : undefined;
  }
  return node.ShapeDataURL ? { source: fileOrApi(node.ShapeDataSource), url: node.ShapeDataURL } : undefined;
}

// A node's bare SubLayersAPI URL -> the {url}[] shape
// NXMapAppConfig.subLayerApis/StaticLayerRef.subLayerApis expect. undefined
// (not []) when absent, so a ref that never asked for sub-layer groups at
// all is visibly distinct from one whose endpoint just returned nothing.
function subLayerApisOf(node: RawLayerNode): SubLayerApiConfig[] | undefined {
  return node.SubLayersAPI ? [{ url: node.SubLayersAPI }] : undefined;
}

// Converts one RawLayerNode tree (root + its Configuration[] children) into
// the exact NXMapAppConfig shape pdo-map-config.json is an instance of — same
// field names/nesting the component/builder already expect, so this can be
// handed straight to NxMapDemoComponent in place of importing
// pdo-map-config.json, with zero other code changes.
export function buildAppConfig(root: RawLayerNode): NXMapAppConfig {
  const staticLayers: StaticLayerRef[] = (root.Configuration ?? []).map(child => ({
    configSource: configSourceOf(child),
    shapeDataSource: shapeDataSourceOf(child),
    subLayerApis: subLayerApisOf(child),
    theme: child.Theme ?? undefined,
    participateInFilter: true
  }));

  return {
    baseLayerConfigSource: configSourceOf(root),
    shapeDataSource: shapeDataSourceOf(root),
    subLayerApis: subLayerApisOf(root) ?? [],
    theme: root.Theme ?? undefined,
    staticLayers
  };
}
