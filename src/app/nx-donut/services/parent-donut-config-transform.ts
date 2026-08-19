import {
  DonutConfig,
  DonutSlice,
  RawDonutCollectionNode,
  RawDonutNode,
  TrendGroup,
  TrendLeaf
} from "../model/nx-donut-model";

// Real upstream discriminant for "this node is a collection of donuts, not
// a donut itself" — mirrors nx-map's MAP_COLLECTION_COMPONENT_TYPE
// (parent-config-transform.ts), same convention, independent constant per
// this component's own "shares nothing with nx-map" design.
const DONUT_COLLECTION_COMPONENT_TYPE = 7121;

// Same normalization nx-map's slugifyLayerFileName() uses for its own
// name-matching (LayerFileLists/LayersDefaultSelected) — trim + lowercase +
// collapse non-alphanumeric runs, so "Dissolved H2S", "dissolved-h2s", and
// "DISSOLVED_H2S" all match each other. Reimplemented here rather than
// imported, per this component's own "shares nothing with nx-map" design.
function normalizeName(name: string | null | undefined): string {
  return (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Flattens every leaf across every group/node in the response into one
// lookup keyed by its own (normalized) TrendName — the response's outer
// group/node nesting carries no meaning for matching, only the innermost
// TrendName does.
function indexTrendLeaves(response: TrendGroup[] | null | undefined): Map<string, TrendLeaf> {
  const index = new Map<string, TrendLeaf>();
  (response ?? []).forEach(group =>
    (group.TrendsList ?? []).forEach(node =>
      (node.TrendsList ?? []).forEach(leaf => {
        const key = normalizeName(leaf.TrendName);
        if (key) {
          index.set(key, leaf);
        }
      })
    )
  );
  return index;
}

// RawDonutNode.Data comes in as a JSON-encoded string on a real upstream
// node (see its own comment) — parsed here, tolerant of a plain array
// (inline/test callers) and of a malformed/absent string (falls back to
// empty rather than throwing and taking down the whole collection over one
// bad node).
function parseNodeData(data: DonutSlice[] | string | null | undefined): DonutSlice[] {
  if (Array.isArray(data)) {
    return data;
  }
  if (!data) {
    return [];
  }
  try {
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildSlices(leaf: TrendLeaf | undefined): DonutSlice[] {
  return (leaf?.Series ?? []).map(series => ({
    x: series.SeriesName ?? series.LegendName ?? "",
    y: Number(series.Data?.[0]?.YValue) || 0,
    color: series.Data?.[0]?.ItemStyle?.color || series.Color || undefined,
    // Per-slice tooltip text straight from the API's own Data[0].ToolTip —
    // see DonutSlice.tooltip's own comment for how NxDonutComponent uses
    // this (wins outright over the format-based default when non-empty).
    tooltip: series.Data?.[0]?.ToolTip || undefined
  }));
}

// Converts one RawDonutNode + its matched trend leaf into the DonutConfig
// shape NxDonutComponent already expects. Two independent sources for
// `data`, in priority order:
//   1. The trend API response's own matched leaf, when it has at least one
//      slice — always wins outright, never merged slice-by-slice with the
//      node's own Data.
//   2. node.Data — this donut's own hardcoded fallback, used whenever the
//      API has no match for this Name (leaf undefined) OR matched a leaf
//      with no usable Series (buildSlices() came back empty).
// Both absent renders the existing empty-ring state (isEmpty), same as
// before this fallback existed — no third "hardcoded zeros" tier needed.
export function buildDonutConfig(node: RawDonutNode, leaf: TrendLeaf | undefined): DonutConfig {
  const apiSlices = buildSlices(leaf);
  return {
    id: normalizeName(node.Name) || String(node.Id ?? ""),
    label: node.Name ?? "",
    radius: node.Radius ?? undefined,
    tooltipFormat: node.TooltipFormat ?? undefined,
    data: apiSlices.length ? apiSlices : parseNodeData(node.Data)
  };
}

// Converts the real upstream collection node + its trend API response into
// one DonutConfig per Configuration[] entry, ordered by each entry's own
// Order (ascending; ties keep Configuration[]'s own declared relative order
// — Array.sort() is stable) rather than that array's raw declaration order.
//
// Falls back to treating `root` itself as a single donut when it isn't
// actually a ComponentType 7121 (COMPONENT_NXCIRCULAR_COLLECTION) wrapper —
// same fallback shape as nx-map's buildMapCollectionConfig().
export function buildDonutConfigs(root: RawDonutCollectionNode, trendResponse: TrendGroup[]): DonutConfig[] {
  const items = root.ComponentType === DONUT_COLLECTION_COMPONENT_TYPE ? root.Configuration ?? [] : [root as RawDonutNode];
  const ordered = [...items].sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0));
  const leaves = indexTrendLeaves(trendResponse);
  return ordered.map(node => buildDonutConfig(node, leaves.get(normalizeName(node.Name))));
}
