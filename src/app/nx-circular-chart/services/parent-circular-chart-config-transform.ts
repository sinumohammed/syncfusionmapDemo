import {
  CircularChartConfig,
  CircularChartSlice,
  CircularChartTypes,
  RawCircularChartCollectionNode,
  RawCircularChartNode,
  TrendGroup,
  TrendLeaf
} from "../model/nx-circular-chart-model";

// Real upstream discriminant for "this node is a collection of circularCharts, not
// a circular chart itself" — mirrors nx-map's MAP_COLLECTION_COMPONENT_TYPE
// (parent-config-transform.ts), same convention, independent constant per
// this component's own "shares nothing with nx-map" design.
const CIRCULAR_CHART_COLLECTION_COMPONENT_TYPE = 7121;

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

// RawCircularChartNode.Data comes in as a JSON-encoded string on a real upstream
// node (see its own comment) — parsed here, tolerant of a plain array
// (inline/test callers) and of a malformed/absent string (falls back to
// empty rather than throwing and taking down the whole collection over one
// bad node).
function parseNodeData(data: CircularChartSlice[] | string | null | undefined): CircularChartSlice[] {
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

function buildSlices(leaf: TrendLeaf | undefined): CircularChartSlice[] {
  return (leaf?.Series ?? []).map(series => ({
    x: series.SeriesName ?? series.LegendName ?? "",
    y: Number(series.Data?.[0]?.YValue) || 0,
    color: series.Data?.[0]?.ItemStyle?.color || series.Color || undefined,
    // Per-slice tooltip text straight from the API's own Data[0].ToolTip —
    // see CircularChartSlice.tooltip's own comment for how NxCircularChartComponent uses
    // this (wins outright over the format-based default when non-empty).
    tooltip: series.Data?.[0]?.ToolTip || undefined
  }));
}

// Converts one RawCircularChartNode + its matched trend leaf into the CircularChartConfig
// shape NxCircularChartComponent already expects. Two independent sources for
// `data`, in priority order:
//   1. The trend API response's own matched leaf, when it has at least one
//      slice — always wins outright, never merged slice-by-slice with the
//      node's own Data.
//   2. node.Data — this circular chart's own hardcoded fallback, used whenever the
//      API has no match for this Name (leaf undefined) OR matched a leaf
//      with no usable Series (buildSlices() came back empty).
// Both absent renders the existing empty-ring state (isEmpty), same as
// before this fallback existed — no third "hardcoded zeros" tier needed.
export function buildCircularChartConfig(node: RawCircularChartNode, leaf: TrendLeaf | undefined): CircularChartConfig {
  const apiSlices = buildSlices(leaf);
  return {
    id: normalizeName(node.Name) || String(node.Id ?? ""),
    label: node.Name ?? "",
    radius: node.Radius ?? undefined,
    tooltipFormat: node.TooltipFormat ?? undefined,
    // The trend API's own ChartType (leaf.Series[0], see TrendSeries' own
    // comment) overrides node.Type when present, same API-wins-over-config
    // precedence as `data` below — both are already the same numeric enum
    // CircularChartTypes uses, so no separate mapping, just the type cast
    // plus a default for absent/null.
    chartType: ((leaf?.Series?.[0]?.ChartType ?? node.ChartType) as CircularChartTypes | null | undefined) ?? CircularChartTypes.Doughnut,
    applyGradient: leaf?.Series?.[0]?.ApplyGradient ?? node.ApplyGradient ?? undefined,
    data: apiSlices.length ? apiSlices : parseNodeData(node.Data)
  };
}

// Converts the real upstream collection node + its trend API response into
// one CircularChartConfig per Configuration[] entry, ordered by each entry's own
// Order (ascending; ties keep Configuration[]'s own declared relative order
// — Array.sort() is stable) rather than that array's raw declaration order.
//
// Falls back to treating `root` itself as a single circular chart when it isn't
// actually a ComponentType 7121 (COMPONENT_NXCIRCULAR_COLLECTION) wrapper —
// same fallback shape as nx-map's buildMapCollectionConfig().
export function buildCircularChartConfigs(root: RawCircularChartCollectionNode, trendResponse: TrendGroup[]): CircularChartConfig[] {
  const items = root.ComponentType === CIRCULAR_CHART_COLLECTION_COMPONENT_TYPE ? root.Configuration ?? [] : [root as RawCircularChartNode];
  const ordered = [...items].sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0));
  const leaves = indexTrendLeaves(trendResponse);
  return ordered.map(node => buildCircularChartConfig(node, leaves.get(normalizeName(node.Name))));
}
