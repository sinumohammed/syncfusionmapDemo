import { NXMapAppConfig, StaticLayerRef, SubLayerApiConfig } from "../model/nx-map-app-config";
import { DataSource, MapCollectionConfig } from "../model/nx-map-model";

// The real upstream payload's own discriminant for "this node is a
// collection of maps, not a map itself" — every node under a
// COMPONENT_NX_MAP_COLLECTION's own Configuration[] is a ComponentType 7118
// (COMPONENT_NX_MAP) RawLayerNode, i.e. exactly what buildAppConfig() below
// already expects one of. See buildMapCollectionConfig()'s own comment for
// how this decides root's Configuration is "one map's static layers" vs
// "one map per entry".
const MAP_COLLECTION_COMPONENT_TYPE = 7119;

// Real upstream shape — one node per layer (the root = base layer, each
// entry in `Configuration` = a static layer). Deliberately typed loosely
// (only the fields this transform actually reads) — a real node carries many
// other unrelated properties (Columns, Icon, WidgetId, ...), all ignored
// here. `Configuration` is only ever populated on the root in practice, but
// typed as recursive/nullable to match what the raw payload allows.
// `ComponentType` is optional/untyped-loosely here too — only
// buildMapCollectionConfig() below actually reads it (to tell a
// COMPONENT_NX_MAP_COLLECTION wrapper apart from an ordinary base-layer
// node), buildAppConfig() itself never looks at it.
export interface RawLayerNode {
  ComponentType?: number;
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

// Converts the real upstream payload's own top-level node into
// NxMapCollectionComponent's MapCollectionConfig — one <app-nx-map-demo> per
// entry in root.Configuration, each entry being its own ComponentType 7118
// RawLayerNode (e.g. "OMAN_BASE_MAP" — a base layer plus its own nested
// static layers under ITS Configuration[], exactly what buildAppConfig()
// above already expects), NOT the base layer's own static-layer children
// buildAppConfig() loops over — those live one level deeper, inside each
// map's own Configuration.
//
// Falls back to treating `root` itself as a single map when it isn't
// actually a ComponentType 7119 (COMPONENT_NX_MAP_COLLECTION) wrapper —
// keeps an older, pre-collection payload (a bare base-layer RawLayerNode,
// no wrapper at all) working unchanged with zero call-site branching.
export function buildMapCollectionConfig(root: RawLayerNode): MapCollectionConfig<RawLayerNode> {
  const items = root.ComponentType === MAP_COLLECTION_COMPONENT_TYPE ? root.Configuration ?? [] : [root];
  return { maps: items.map(item => ({ source: "inline", value: item })) };
}
