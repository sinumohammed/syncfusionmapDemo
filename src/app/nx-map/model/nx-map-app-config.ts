import { DataSource, LayerFileEnvelope, MapConfig } from "./nx-map-model";

// Top-level, deployment-swappable description of where every piece of map
// data comes from.
export interface NXMapAppConfig {
  // No separate baseLayerName field — the base layer's name is whatever
  // baseLayerConfigSource resolves to (its own `layerName`), same as any
  // other layer. Keeping a second, independently-set name here would be a
  // value a caller has to remember to keep in sync with the config's own
  // layerName, with no enforcement if it ever drifted (e.g. the
  // name-based shape lookup in NXMapConfigService.resolveShapeData() would
  // silently key against the wrong name).
  baseLayerConfigSource: DataSource<MapConfig>;
  // Every child layer this map brings in, from all three sources, in this
  // order — see parent-config-transform.ts's buildAppConfig() and
  // NxMapDemoComponent.loadMap(), which resolves and concatenates all
  // three into one list ("union") before building the map. A layer's own
  // shapeData (if any) travels with it in its own LayerFileEnvelope — there
  // is no separate per-layer shape source anymore, unlike the base layer
  // (see baseLayerConfigSource's own comment).
  layerFileSources: DataSource<LayerFileEnvelope>[];
  layerApiUrl?: string;
  layerInlineJSON?: LayerFileEnvelope[];
  // When set, ONLY child layers whose own layerName appears here start
  // checked/visible on load — every other child layer still renders and
  // still appears in the filter tree, just starts unchecked (see
  // MapConfig.selected). Overrides any individual layer's own `selected`.
  // Undefined (the default) leaves each layer's own `selected` (or true)
  // in charge — see NxMapDemoComponent.loadMap() for where this is applied
  // and parent-config-transform.ts's RawLayerNode.LayersDefaultSelected for
  // where it comes from.
  defaultSelectedLayerNames?: string[];
  // Fetched fresh on every circular chart click (NxMapDemoComponent.
  // applyCircularChartSelectionChange()), with the clicked metric id sent as a
  // `metricId` query param — see NXMapConfigService.loadDataOverlay()
  // and MetricOverlayRecord's own comment for the response shape and how
  // each entry gets matched to (or plotted as) a marker. Undefined (the
  // default) means a circular chart click has nothing to fetch — logged loudly
  // (console.error + toast) rather than silently doing nothing.
  dataApiUrl?: string;
  // App-wide default theme (a name into nx-map-themes.json) — every layer
  // inherits this unless it sets its own MapConfig.theme, which wins. Set
  // this ONCE here instead of repeating the same theme on every layer's own
  // config.
  theme?: string;
  // App-wide hover-tooltip fallback defaults — from
  // RawLayerNode.TooltipFormat (parent-config-transform.ts's
  // parseTooltipFormat()), a JSON-encoded string on the real upstream
  // payload. columns/layout sit one level BELOW a static layer's own
  // MapConfig.tooltipTemplate.columns/.layout (that still wins when set —
  // see NxMapDemoComponent.loadMap()'s own merge) but ABOVE
  // NXMapBuilderService.DEFAULT_TOOLTIP_TEMPLATE's hardcoded fallback.
  // dateFormat (NXMapBuilderService.setDateFormat()/formatDate()) has no
  // per-layer override today — this is its only configurable source above
  // NXMapBuilderService's own hardcoded default pattern. The fallback TEXT
  // shown when a reading has no Date at all (NXMapBuilderService's own
  // dateFallback) is not configurable from here at all yet — always that
  // service's own hardcoded placeholder.
  tooltipFormat?: {
    columns?: number;
    layout?: string;
    dateFormat?: string;
  };
}
