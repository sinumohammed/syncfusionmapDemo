import { NXMapAppConfig } from "../model/nx-map-app-config";
import { DataSource, LayerFileEnvelope, MapCollectionConfig } from "../model/nx-map-model";

// The real upstream payload's own discriminant for "this node is a
// collection of maps, not a map itself" — every node under a
// COMPONENT_NX_MAP_COLLECTION's own Configuration[] is a ComponentType 7118
// (COMPONENT_NX_MAP) RawLayerNode, i.e. exactly what buildAppConfig() below
// already expects one of. See buildMapCollectionConfig()'s own comment for
// how this decides root's Configuration is "one map's static layers" vs
// "one map per entry".
const MAP_COLLECTION_COMPONENT_TYPE = 7119;

// Where every LayerFileLists name resolves to on disk — see
// slugifyLayerFileName() and layerFileSourcesOf() below, and
// NXMapConfigService.resolveShapeData() (the base layer's own shape lookup
// uses this same folder/convention, keyed by layerName instead of a
// LayerFileLists entry).
export const LAYER_FILES_BASE_PATH = "assets/nx-map/layers";

// Real upstream shape — one node per map (root = base layer). A map's own
// child layers no longer live inline here at all (see LayerFileLists/
// LayerAPIURL/LayerInlineJSON below) — `Configuration` is only ever read
// by buildMapCollectionConfig() (root's own Configuration[] = one map per
// entry), never by buildAppConfig(). Deliberately typed loosely (only the
// fields this transform actually reads) — a real node carries many other
// unrelated properties (Columns, Icon, WidgetId, ...), all ignored here.
export interface RawLayerNode {
  ComponentType?: number;
  // This map's own settings ONLY — layerName, baseMapType,
  // availableBaseMapTypes, mapCenter, zoomFactor, title, dataLabel, theme,
  // etc. (no groups, no shape source) — a JSON-encoded string, always
  // inline (no file/api option; unlike the three fields below, there is no
  // remote-fetch variant of a map's own settings).
  MainLayerSettings: string;
  // Comma-separated layer names, e.g. "MOL,AlWusta,Surface,Sub Surface" —
  // each resolved (via slugifyLayerFileName()) to its own file at
  // `${LAYER_FILES_BASE_PATH}/<slug>.json`, fetched at runtime and parsed
  // as a LayerFileEnvelope. See layerFileSourcesOf() below.
  LayerFileLists?: string | null;
  // A URL fetched once at runtime, expected to return a LayerFileEnvelope[]
  // (can bring in several layers from one call) — resolved the same way as
  // any other "api" DataSource, via NXMapConfigService.resolve().
  LayerAPIURL?: string | null;
  // Same LayerFileEnvelope[] shape as LayerAPIURL's response, provided
  // directly — no fetch needed. A JSON-ENCODED STRING, same convention as
  // MainLayerSettings (the real upstream payload never sends this field as an
  // actual array) — buildAppConfig() below JSON.parses it.
  LayerInlineJSON?: string | null;
  // Comma-separated layer names (matched against each child layer's own
  // resolved `layerName`, e.g. "MOL" — same names LayerFileLists/
  // LayerAPIURL/LayerInlineJSON's own layerConfig.layerName use, NOT
  // necessarily the LayerFileLists name before slugifying) — when present,
  // ONLY these child layers start checked/visible on load; every other
  // child layer this map brings in (from any of the three sources) still
  // renders fully and still appears in the filter tree, just starts
  // unchecked, exactly like MapConfig.selected: false (see its own
  // comment) — a user can still check it on manually. Overrides whatever
  // an individual layer's own `selected` says — see buildAppConfig()'s own
  // comment for the precedence between the two. Null/absent (the default)
  // leaves every layer's own `selected` (or true) as the starting state,
  // same as before this property existed. Never affects the main/base
  // layer, which always starts checked regardless (its checkbox is
  // disabled either way).
  LayersDefaultSelected?: string | null;
  // A URL fetched fresh on every donut click, with the clicked metric id
  // sent as a query param — see NXMapAppConfig.dataApiUrl's own
  // comment. Null/absent means a donut click has nothing to fetch.
  DataAPIURL?: string | null;
  // App-wide default theme (NXMapAppConfig.theme) — null/absent keeps every
  // layer falling through to its own MapConfig.theme, then "default".
  Theme?: string | null;
  // Only meaningful on the root MAP COLLECTION node — one entry per map
  // (see buildMapCollectionConfig()). Not read for a map's own children
  // anymore (see this interface's own comment above).
  Configuration?: RawLayerNode[] | null;
}

// Lowercases and collapses any run of non-alphanumeric characters to a
// single "-", so "Sub Surface", "Sub surface", "sub-surface", and
// "Sub-Surface" all resolve to the same file. Shared by layerFileSourcesOf()
// (LayerFileLists name -> filename) and NXMapConfigService.resolveShapeData()
// (a layer's own layerName -> its shape file, same folder/convention).
export function slugifyLayerFileName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Comma-separated -> trimmed, non-empty names, in list order. Shared by
// LayerFileLists (below) and LayersDefaultSelected (buildAppConfig()).
function parseCommaList(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map(name => name.trim())
    .filter(name => name.length > 0);
}

// A node's LayerFileLists -> one DataSource<LayerFileEnvelope> per name, in
// list order. Each resolves (NXMapConfigService.resolve()) to a single
// layer's full envelope — unlike LayerAPIURL/LayerInlineJSON, which each
// carry several layers at once, one file is always exactly one layer.
function layerFileSourcesOf(node: RawLayerNode): DataSource<LayerFileEnvelope>[] {
  return parseCommaList(node.LayerFileLists).map(name => ({
    source: "file",
    url: `${LAYER_FILES_BASE_PATH}/${slugifyLayerFileName(name)}.json`
  }));
}

// Converts one RawLayerNode (the base/only layer left in this shape) into
// the exact NXMapAppConfig shape NxMapDemoComponent already expects.
export function buildAppConfig(root: RawLayerNode): NXMapAppConfig {
  const defaultSelectedLayerNames = parseCommaList(root.LayersDefaultSelected);
  return {
    baseLayerConfigSource: { source: "inline", value: JSON.parse(root.MainLayerSettings) },
    layerFileSources: layerFileSourcesOf(root),
    layerApiUrl: root.LayerAPIURL ?? undefined,
    layerInlineJSON: root.LayerInlineJSON ? JSON.parse(root.LayerInlineJSON) : undefined,
    // Empty (LayersDefaultSelected unset) -> undefined, not [] — loadMap()
    // treats an empty array and "unset" identically today, but undefined
    // reads more honestly as "no restriction" than an empty list of names.
    defaultSelectedLayerNames: defaultSelectedLayerNames.length ? defaultSelectedLayerNames : undefined,
    dataApiUrl: root.DataAPIURL ?? undefined,
    theme: root.Theme ?? undefined
  };
}

// Converts the real upstream payload's own top-level node into
// NxMapCollectionComponent's MapCollectionConfig — one <app-nx-map-demo> per
// entry in root.Configuration, each entry being its own ComponentType 7118
// RawLayerNode (e.g. "OMAN_BASE_MAP"), exactly what buildAppConfig() above
// already expects one of.
//
// Falls back to treating `root` itself as a single map when it isn't
// actually a ComponentType 7119 (COMPONENT_NX_MAP_COLLECTION) wrapper —
// keeps an older, pre-collection payload (a bare base-layer RawLayerNode,
// no wrapper at all) working unchanged with zero call-site branching.
export function buildMapCollectionConfig(root: RawLayerNode): MapCollectionConfig<RawLayerNode> {
  const items = root.ComponentType === MAP_COLLECTION_COMPONENT_TYPE ? root.Configuration ?? [] : [root];
  return { maps: items.map(item => ({ source: "inline", value: item })) };
}
