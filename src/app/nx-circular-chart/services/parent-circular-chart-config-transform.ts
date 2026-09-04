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
  // Param1/Param2/Param3, in that order, skipping absent/null/empty ones —
  // any value present wins outright over the Name/Id fallback (see
  // RawCircularChartNode.Param1's own comment). Empty array (all three
  // unset) leaves sublayerIds undefined, so onCircularChartSelected()'s own
  // `?? circularChart.id` fallback still applies unchanged.
  const params = [node.Param1, node.Param2, node.Param3].filter((p): p is string => !!p);
  return {
    id: normalizeName(node.Name) || String(node.Id ?? ""),
    label: node.Name ?? "",
    radius: node.Radius ?? undefined,
    innerRadius: node.InnerRadius ?? undefined,
    tooltipFormat: node.TooltipFormat ?? undefined,
    sublayerIds: params.length ? params : undefined,
    // The trend API's own ChartType (leaf, see TrendLeaf's own comment)
    // overrides node.ChartType when present, same API-wins-over-config
    // precedence as `data` below — both are already the same numeric enum
    // CircularChartTypes uses, so no separate mapping, just the type cast
    // plus a default for absent/null.
    chartType: ((leaf?.ChartType ?? node.ChartType) as CircularChartTypes | null | undefined) ?? CircularChartTypes.Doughnut,
    applyGradient: leaf?.ApplyGradient ?? node.ApplyGradient ?? undefined,
    zeroAsHealthy: node.ZeroAsHealthy ?? undefined,
    // leaf.Label (trend API) wins outright over node.Label (config) when
    // present — same field name on both sides, same API-wins-over-config
    // precedence as chartType/applyGradient above — see
    // CircularChartCardConfig.healthyLabel's own comment.
    healthyLabel: leaf?.Label || node.Label || undefined,
    data: apiSlices.length ? apiSlices : parseNodeData(node.Data)
  };
}

// Converts the real upstream collection node + its trend API response into
// one CircularChartConfig per Configuration[] entry THAT HAS A MATCHING trend
// leaf — a node whose Name has no leaf anywhere in trendResponse (product
// decision: the trend response is the final, authoritative list of which
// circular charts exist right now) is dropped entirely, not rendered with
// its own hardcoded node.Data fallback or an empty-ring placeholder. That
// fallback (buildCircularChartConfig()'s own apiSlices.length ? apiSlices :
// parseNodeData(node.Data)) still applies for a node that DOES have a
// matching leaf but whose leaf carries no usable Series — a real "matched,
// no readings yet" case, distinct from "not in this response at all".
// Ordered by each entry's own Order (ascending; ties keep Configuration[]'s
// own declared relative order — Array.sort() is stable) rather than that
// array's raw declaration order.
//
// Falls back to treating `root` itself as a single circular chart when it isn't
// actually a ComponentType 7121 (COMPONENT_NXCIRCULAR_COLLECTION) wrapper —
// same fallback shape as nx-map's buildMapCollectionConfig().
//
// `useConfigFallback` (set by NxCircularChartCollectionComponent whenever
// there's no live trend source at all — no ApiUrl AND no non-empty
// trendResponse @Input) skips the leaves.has() filter below and renders
// EVERY Configuration[] entry off its own node.Data instead. Without this,
// a collection with no ApiUrl rendered nothing at all: indexTrendLeaves([])
// is always empty, so every node failed that filter regardless of having
// its own hardcoded Data to fall back to. The filter itself stays the
// default (product decision, see its own comment below) for the normal
// case where a real trend source IS in play, just possibly returning fewer
// matches than there are configured items.
export function buildCircularChartConfigs(
  root: RawCircularChartCollectionNode,
  trendResponse: TrendGroup[],
  useConfigFallback = false
): CircularChartConfig[] {
  const items = root.ComponentType === CIRCULAR_CHART_COLLECTION_COMPONENT_TYPE ? root.Configuration ?? [] : [root as RawCircularChartNode];
  // Hide is a config-only kill switch (see RawCircularChartNode.Hide's own
  // comment) — dropped before trend-leaf matching/ordering, same as if the
  // node were never in Configuration[] at all, regardless of ApiUrl/
  // trendResponse/useConfigFallback.
  const visible = items.filter(node => !node.Hide);
  const ordered = [...visible].sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0));
  const leaves = indexTrendLeaves(trendResponse);
  const matched = useConfigFallback ? ordered : ordered.filter(node => leaves.has(normalizeName(node.Name)));
  return matched.map(node => buildCircularChartConfig(node, leaves.get(normalizeName(node.Name))));
}

// How many circular chart cards THIS config alone (no trend data at all) says
// should exist — same ComponentType/Hide unwrapping buildCircularChartConfigs()
// itself does, minus the trend-leaf matching/ordering, since a skeleton
// loader (NxCircularChartCollectionComponent's own `loading` state) needs
// this BEFORE any trend response has come back to match against. Not
// necessarily the exact count buildCircularChartConfigs() ends up rendering
// once real data lands (a matched-only fetch can still drop configured
// items with no corresponding trend leaf) — just the best available guess
// for how many placeholder cards to show while waiting.
export function visibleCircularChartCount(root: RawCircularChartCollectionNode | undefined): number {
  if (!root) {
    return 0;
  }
  const items = root.ComponentType === CIRCULAR_CHART_COLLECTION_COMPONENT_TYPE ? root.Configuration ?? [] : [root as RawCircularChartNode];
  return items.filter(node => !node.Hide).length;
}
