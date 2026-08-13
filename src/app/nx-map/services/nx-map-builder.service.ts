import { Injectable } from "@angular/core";
import { MarkerSettingsModel } from "@syncfusion/ej2-angular-maps";
import * as nxMapThemesJson from "../config/nx-map-themes.json";
import {
  ClusterConfig,
  GeoLocation,
  GraphicLookup,
  GraphicType,
  MapCircle,
  MapConfig,
  MapGroup,
  MapLine,
  MapOptions,
  MapPoint,
  MapPolygon,
  MapTheme,
  MapThemeFill,
  MapThemeRegistry,
  MarkerShape,
  ParseTargetResult,
  PointMetric,
  ShapeStyle,
  TooltipTemplateConfig
} from "../model/nx-map-model";

// Bundled the same way pdo-map-config.json is in nx-map-demo.component.ts —
// a compile-time import, no HTTP round trip, so buildMap()/initialize() stay
// synchronous.
const nxMapThemes: MapThemeRegistry = ((nxMapThemesJson as any).default ?? nxMapThemesJson) as MapThemeRegistry;

// Tile sources for the two raster baseMapType options. Both are free/no-key
// services — "osm" streets from OpenStreetMap, "satellite" imagery from
// Esri's World Imagery service — using Syncfusion's own level/tileX/tileY
// placeholder tokens (Esri's REST tile scheme is {z}/{y}/{x}, so tileY comes
// before tileX in the URL to match).
const TILE_URL_TEMPLATES: Record<"osm" | "satellite", string> = {
  osm: "https://a.tile.openstreetmap.org/level/tileX/tileY.png",
  satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/level/tileY/tileX"
};

// Stand-in shapeData for a points/groups-only layer (MOL-style) — a
// LayerFileEnvelope with no shapeData of its own still needs SOMETHING to
// satisfy Syncfusion's SubLayer machinery, even though this layer draws no
// real boundary; a single feature with empty coordinates renders nothing.
// See NxMapDemoComponent.loadMap().
export const EMPTY_PLACEHOLDER_SHAPE = {
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: [] } }]
};

// Optional highlight-color palette, by metric/donut id — used ONLY for a
// point whose metrics[activeMetricId].status is "high" once that metric's
// donut is clicked (see buildMarkerPoints()'s activeMetricId branch) and
// for a "high" reading's tooltip tile color (toMarker()). A metric id
// that isn't listed here (any brand-new one the fetched data introduces
// tomorrow, not just these seven) just falls back to NORMAL_LABEL_COLOR
// everywhere this is read — this is purely a nicer-looking extra, never a
// gate on whether that metric's marker/tooltip actually works. Add an
// entry here for a new metric id only if it deserves its own distinct
// highlight color; unrelated to a point's own base marker color, which
// keeps rendering normally underneath regardless of any donut selection.
export const METRIC_COLORS: Record<string, string> = {
  tvp: "#c94a3f",
  salt: "#3fbfbf",
  bsw: "#c9a63f",
  h2s: "#3fae5a",
  api: "#3f78c9",
  flow: "#8e5ea2",
  other: "#5f6368"
};

// Shared label color for a "normal"-status reading, regardless of which
// metric is active — only "high" readings get their metric's own
// METRIC_COLORS entry.
const NORMAL_LABEL_COLOR = "#5f6368";

// Genuinely empty starting point — no metric ids baked in here at all.
// Used only as the very first template before ANY layer's own
// MapConfig.tooltipTemplate.columns is known (columns needs SOME number);
// `items` stays empty because NxMapDemoComponent.deriveTooltipTemplate()
// is what actually populates the tile list, straight from whatever the
// fetched metric data (or a layer's own tooltipTemplate.items) contains —
// see TooltipTemplateItem's own comment for why no fixed metric-id list
// belongs here anymore.
export const DEFAULT_TOOLTIP_TEMPLATE: TooltipTemplateConfig = {
  columns: 2,
  items: []
};

// Fallback icon shape per impact value when a group's own
// MapGroup.impactMarkerStyle doesn't override it — see
// toMetricOverlayMarker()'s own comment for the full resolution order.
// Lowercase to match the CSS class suffix (.marker-label-icon--diamond
// etc, see nx-map-demo.component.ts's injectMarkerLabelTemplate()) rather
// than a MarkerShape enum value — this drives that template icon, not
// Syncfusion's own shape rendering.
export const DEFAULT_IMPACT_SHAPES: Record<"customer" | "non-customer", string> = {
  customer: "diamond",
  "non-customer": "triangle"
};

interface LayerState {
  config: MapConfig;
  shapeData: any;
  groups: MapGroup[];
  // Controls the whole Syncfusion layer's `visible` flag — hides the
  // region's shape/boundary AND everything in it, distinct from a group's
  // own `visible` (which only hides that group's markers/lines/polygons
  // within a still-visible layer).
  visible: boolean;
  // One entry per feature in shapeData.features (empty when shapeData isn't
  // a multi-feature FeatureCollection) — lets the filter tree show/hide one
  // shape polygon (e.g. Al Wusta's "Lekhwair Cluster"/"Qarn Alam Cluster")
  // independently of the rest of the layer. Index-aligned with
  // shapeData.features, NOT cloned per feature — see visibleShapeData().
  shapeFeatureVisible: boolean[];
  // Resolved once in initialize() from config.theme — always a full
  // (possibly empty) MapTheme object, defaulting to the "default" entry for
  // an unset or unrecognized theme name. See resolveTheme().
  theme: MapTheme;
}

// One entry per group in the layer control's tree UI. Every
// marker/polygon/circle/line field here is a LIVE reference into this
// layer's state (post-flatten) — toggling `.visible` on any of them and
// calling refresh() is all a consumer needs to do; no id-matching required.
export interface GroupEntry {
  group: MapGroup;
  markers: MapPoint[];
  polygons: MapPolygon[];
  circles: MapCircle[];
  lines: MapLine[];
}

// One entry per shape-data feature (e.g. Al Wusta's "Lekhwair Cluster") a
// layer's boundary GeoJSON carries — only populated for layers whose
// shapeData is a multi-feature FeatureCollection. Toggling `visible` off
// filters that one feature out of what's sent to Syncfusion (see
// NXMapBuilderService.visibleShapeData()), same "removed from the map, not
// just dimmed" behavior as unchecking a group leaf.
export interface ShapeFeatureEntry {
  index: number;
  name: string;
  visible: boolean;
}

// Buckets shapeData features sharing the same GeoJSON `properties.region`
// (e.g. Al Wusta's "Lekhwair Cluster" under "Al Wusta North", "Qarn Alam
// Cluster" under "Al Wusta South") — a toggleable section in the filter
// tree, same idea as HeadingNode for groups. Purely data-driven: set
// `region` directly in the feature's own `properties` in the shapeData
// file, no separate config flag — a feature with no `region` set just
// stays in LayerTreeNode.shapeFeatures (ungrouped), same as before this
// existed.
export interface ShapeFeatureGroupNode {
  region: string;
  features: ShapeFeatureEntry[];
}

// Groups sharing the same MapGroup.heading (e.g. groups delivered by a
// sub-layer API call, tagged with a heading at fetch time) are bucketed
// together under one of these — a toggleable section in the filter popup,
// checked when every group under it is visible.
export interface HeadingNode {
  heading: string;
  groups: GroupEntry[];
}

// One node per layer in the layer control's tree UI (plus nested children
// for any layer whose MapConfig.parentLayerName points at this one).
export interface LayerTreeNode {
  layerIndex: number;
  layerName: string;
  displayName: string;
  visible: boolean;
  // True for whichever layer is at position 0 (see MapConfig's own comment
  // on why "main" is purely positional) — the layer panel should disable
  // this node's own checkbox, since hiding it would leave the map with
  // nothing to render against.
  isMainLayer: boolean;
  // Groups with no `heading` — rendered directly under this layer, same as
  // before headings existed.
  groups: GroupEntry[];
  // Groups bucketed by `heading`, in first-seen order.
  headings: HeadingNode[];
  // Other layers whose config.parentLayerName === this.layerName — e.g.
  // static layers nested under the base layer in the filter popup, even
  // though each still renders as its own independent Syncfusion SubLayer.
  // Siblings sharing the same MapConfig.region get bucketed into a
  // LayerRegionNode here instead of appearing as their own direct entry —
  // see groupLayersByRegion().
  children: (LayerTreeNode | LayerRegionNode)[];
  // This layer's individual shapeData features with no `region` set —
  // rendered directly under the layer, same as before shapeFeatureGroups
  // existed. Empty for a layer whose shapeData is a single shape, has none
  // at all, or whose every feature is grouped. See ShapeFeatureEntry's own
  // comment.
  shapeFeatures: ShapeFeatureEntry[];
  // shapeData features bucketed by `properties.region`, in first-seen
  // order. See ShapeFeatureGroupNode's own comment.
  shapeFeatureGroups: ShapeFeatureGroupNode[];
  // This layer's own theme override (MapConfig.theme), or undefined when
  // it's inheriting from the app-wide/default theme instead. Drives the
  // layer panel's theme <select> — see setLayerTheme().
  themeName: string | undefined;
}

// Buckets sibling layer nodes sharing the same MapConfig.region into a
// toggleable folder in the layer tree — same idea as HeadingNode for
// groups, but one level up (layer nodes themselves, wherever they'd
// otherwise sit as direct siblings: the tree's root list, or one layer's
// `children`). Purely a display grouping — every layer inside still keeps
// its own independent visibility/state; a region node has no state of its
// own beyond what's derived from its `layers` (see the demo component's
// layerRegionState()/toggleLayerRegion()).
export interface LayerRegionNode {
  region: string;
  layers: LayerTreeNode[];
}

// Discriminates a getLayerTree()/LayerTreeNode.children entry — a
// LayerRegionNode always has `layers`, which no LayerTreeNode has.
export function isLayerRegionNode(node: LayerTreeNode | LayerRegionNode): node is LayerRegionNode {
  return (node as LayerRegionNode).layers !== undefined;
}

@Injectable()
export class NXMapBuilderService {
  // One entry per Syncfusion layer (= one entry in the MapConfig[] passed to
  // buildMap). Each layer keeps its own groups, independent of the others —
  // toggling a group in one layer never touches another layer's markers.
  private layers: LayerState[] = [];

  // renderOrder[renderPosition] = original this.layers index — populated by
  // buildLayers() whenever its paint-order reorder (see that method's own
  // comment) actually moves a layer away from its declared position.
  // Syncfusion numbers each rendered layer's DOM group ("_LayerIndex_<n>")
  // by POSITION in the array buildLayers() returns, not by original
  // layerIndex — nx-map-demo.component.ts's syncLayerDomVisibility() needs
  // this to translate a DOM position back to the correct getLayerVisible()
  // lookup. Without it, show/hide silently targets whichever layer
  // happens to render at that position instead of the one actually
  // toggled (confirmed live: unchecking a layer whose paint position got
  // reordered hid a DIFFERENT layer's shape while leaving the intended
  // one's background on screen, and re-checking it then appeared to do
  // nothing).
  private renderOrder: number[] = [];

  // Keyed by "<layerIndex>:<groupId>:<pointIndex>" — the same key stamped
  // onto each marker's dataSource object as `__lookupKey` in toMarker().
  // Resolves markerClick's `data` arg in O(1) without any DOM-id parsing,
  // and the layerIndex prefix keeps two layers' same-named groups distinct.
  private markerLookup = new Map<string, GraphicLookup>();

  // Which metric ids the always-on hover tooltip currently has a tile for —
  // set via setTooltipMetricKeys(), called by NxMapDemoComponent.loadMap()
  // with the SAME TooltipTemplateConfig.items list it feeds into
  // injectMarkerTooltipTemplate()'s DOM template, so the template's own
  // ${v_<key>} placeholders and toMarker()'s populated fields (below)
  // always agree on exactly the same key set — no separate hardcoded
  // metric-id list on either side. Empty until the first config resolves
  // (or a layer/config never sets a tooltipTemplate at all), which is
  // exactly what leaves the tooltip with no tiles pre-load, same as no
  // reading ever existing for a metric no config mentions.
  private tooltipMetricKeys: string[] = [];

  // Current map zoom factor, same units/scale as MapConfig.zoomFactor/
  // maxZoomFactor — set via setZoomLevel(), called by NxMapDemoComponent.
  // onZoomComplete() on every zoom. buildMarkerPoints() below compares each
  // point's (or its group's) MapGroup.minZoomLevel/MapPoint.minZoomLevel
  // against this to decide whether that point belongs in the marker
  // dataSource at all this build. Starts at 1 — Syncfusion's own
  // least-zoomed-out level (see buildZoom()'s own minZoom) — so a point
  // with a minZoomLevel above 1 correctly starts hidden on first paint,
  // before any zoomComplete has ever fired to set a real value.
  private currentZoomLevel = 1;

  setZoomLevel(level: number): void {
    this.currentZoomLevel = level;
  }

  setTooltipMetricKeys(keys: string[]): void {
    this.tooltipMetricKeys = keys;
  }

  // One lookup array per layer, each aligned with that layer's flat
  // `polygons` array from buildPolygon() (circles pushed first, then real
  // polygons — built in that exact order so indexes always match).
  private polygonLookup: GraphicLookup[][] = [];

  // Index into `this.layers` (post-filter — see initialize()) of the
  // main/base layer. Purely positional: configs[0] passed to initialize()
  // is ALWAYS treated as main, never a per-config flag to search for — see
  // MapConfig's own comment on why. The main layer always renders as
  // Syncfusion's base 'Layer' type (every other config becomes a
  // 'SubLayer'), and it's the one the layer panel won't let the user turn
  // off.
  private mainLayerIndex = 0;

  // The app-wide default theme name (NXMapAppConfig.theme), remembered from
  // the last initialize() call so setLayerTheme() can re-resolve a layer's
  // theme back to "inherit from app-wide" (undefined override) correctly,
  // the same way initialize() itself would.
  private baseTheme: string | undefined;

  constructor() {}

  // `shapeDataByLayer` is keyed by each config's `layerName` — e.g.
  // { omanv1: <oman geojson>, musandam: <musandam geojson>, ... }. Use one
  // MapConfig entry per Syncfusion layer only when each entry has genuinely
  // different geography/shapeData (e.g. separate governorate boundary
  // files). If two "layers" are really just categories over the SAME
  // geography (e.g. Facilities vs Surface points), keep them as groups
  // inside a single MapConfig instead — Syncfusion layers paint over each
  // other in DOM order, so an opaque upper layer's shape fill will hide a
  // lower layer's markers/polygons even though they still exist in the DOM.
  // Use `type: 'SubLayer'` plus a semi-transparent shapeSettings.fill on the
  // config (see buildLayers) when layers must stack over a base layer.
  // baseTheme: the app-wide default theme name (NXMapAppConfig.theme) — a
  // layer with no theme of its own inherits this instead of falling
  // straight to "default", so a deployment can set the look once instead
  // of repeating the same theme on every layer's config. A layer's own
  // `theme` still wins over it (see resolveTheme() below).
  initialize(configs: MapConfig[], shapeDataByLayer: Record<string, any>, baseTheme?: string) {
    this.baseTheme = baseTheme;
    // Purely positional — configs[0] is ALWAYS the main/base layer, however
    // many configs are passed or in whatever order the caller assembled
    // them. Everything else is a static/child layer, no per-config flag to
    // search for; see MapConfig's own comment for why.
    const mainIndex = 0;
    if (configs[mainIndex]?.visible === false) {
      console.warn(
        `[NXMap] Layer "${configs[mainIndex].layerName}" is the main layer and can't be excluded via visible: false — including it anyway.`
      );
    }
    if (configs[mainIndex]?.selected === false) {
      console.warn(
        `[NXMap] Layer "${configs[mainIndex].layerName}" is the main layer and can't start unchecked via selected: false — its checkbox is disabled, so including it fully checked anyway.`
      );
    }

    // Config-time exclusion: layers with visible: false never enter
    // this.layers at all, so they're absent from both the map and
    // getLayerTree()'s filter list. The main layer is exempt (see warning
    // above) — everything else renders relative to it.
    const includedConfigs = configs.filter((c, i) => i === mainIndex || c.visible !== false);

    // Re-derive main's position within includedConfigs (NOT configs) — a
    // visible: false layer earlier in the array may have been dropped,
    // shifting indices.
    this.mainLayerIndex = includedConfigs.indexOf(configs[mainIndex]);

    this.layers = includedConfigs.map((config, i) => {
      // Starting checked/unchecked state — see MapConfig.selected's own
      // comment. The main layer is exempt (same reasoning/warning as
      // visible: false above) and always starts checked. Drives BOTH the
      // layer's own checkbox (visible, below) AND, for a layer with actual
      // per-feature checkboxes, its features' starting state
      // (shapeFeatureVisible, below) — a layer that starts unchecked should
      // read as unchecked all the way down the tree, not leave its own
      // per-feature children (e.g. Al Wusta's North/South clusters) showing
      // checked underneath an unchecked parent. Purely a starting STATE; a
      // feature is still independently toggleable afterward via
      // toggleShapeFeature()/toggleShapeFeatureGroup(), same as before.
      const startSelected = i === this.mainLayerIndex ? true : config.selected ?? true;
      const rawFeatures = shapeDataByLayer[config.layerName]?.features ?? [];
      // Mirrors buildTreeNode()'s own gate for whether a layer gets
      // per-feature checkbox rows at all (shapeFeaturesSelectable AND more
      // than one feature — see its own comment). A layer WITHOUT those
      // (e.g. a single-feature SubLayer) has no tree row to toggle
      // shapeFeatureVisible back on later — toggleLayer()'s own cascade
      // (setLayerTreeVisibility() in nx-map-demo.component.ts) only visits
      // features that exist in the tree, so seeding startSelected here for
      // one of these would permanently strand it: visibleShapeData() below
      // would filter out its one-and-only feature forever, even after the
      // layer's own checkbox was checked back on. Always true instead —
      // the layer-level `visible` flag (this DOM group's own display:none)
      // is the only thing that should ever hide this shape.
      const hasSelectableFeatures = !!config.shapeFeaturesSelectable && rawFeatures.length > 1;
      return {
        config,
        shapeData: shapeDataByLayer[config.layerName],
        visible: startSelected,
        // A fresh initialize() (including a full rebuildMap() reload)
        // resets any prior per-feature hide, same as every other
        // visibility flag cloned below.
        shapeFeatureVisible: rawFeatures.map(() => (hasSelectableFeatures ? startSelected : true)),
        theme: this.resolveTheme(config.theme ?? baseTheme),
        // Every leaf-bearing field is freshly cloned here (not just the
        // group wrapper) — markerConfig.points already was, via
        // flattenPointHierarchy(), but polygons/circles/lines previously
        // came through as the SAME shared objects from `config` on every
        // call. Since configs are cached and reused across repeated
        // initialize() calls (e.g. every reload), a runtime `.visible`
        // toggle on an uncloned polygon/circle/line mutated the shared
        // source data permanently — a "reload resets everything to fully
        // checked" reload silently stayed unchecked forever for any
        // group whose only leaves were polygons/circles/lines (markers were
        // never affected, since those were already cloned).
        groups: (config.groups ?? []).map(group => ({
          ...group,
          markerConfig: group.markerConfig
            ? {
                ...group.markerConfig,
                points: this.flattenPointHierarchy(group.markerConfig.points ?? [])
              }
            : group.markerConfig,
          polygons: (group.polygons ?? []).map(p => ({ ...p, points: [...p.points] })),
          circles: (group.circles ?? []).map(c => ({ ...c })),
          // A line defined via pointIds (see MapLine.pointIds) has no own
          // `points` array at all — only clone it when present, rather than
          // assuming every line has one.
          lines: (group.lines ?? []).map(l => ({ ...l, points: l.points ? [...l.points] : l.points }))
        }))
      };
    });
  }

  // Looks up a theme by name for a layer's config.theme — "default" for an
  // unset name, and "default" again for a name that isn't in the registry
  // (so a typo'd theme falls back to today's stock look instead of
  // rendering with no styling at all). The final `?? {}` is a defensive
  // guard only — it'd take a malformed nx-map-themes.json missing its own
  // "default" entry to ever reach it.
  private resolveTheme(name: string | undefined): MapTheme {
    return nxMapThemes[name ?? "default"] ?? nxMapThemes["default"] ?? {};
  }

  // A group's own theme (e.g. set by a sub-layer API response, per-group —
  // see MapGroup.theme) always wins over its layer's theme; a group with no
  // theme of its own just uses whatever the layer resolved to. This is the
  // theme every per-group builder method (buildMarkerPoints,
  // buildNavigationLines, buildPolygon) should merge point/line/polygon/
  // circle fields against — never layerTheme directly, or a group-level API
  // override would silently do nothing.
  private resolveGroupTheme(group: MapGroup, layerTheme: MapTheme): MapTheme {
    return group.theme ? this.resolveTheme(group.theme) : layerTheme;
  }

  // Every theme name in the registry — for a UI (e.g. the layer panel's
  // theme <select>) to offer as choices. "default" is included; callers
  // that want an explicit "inherit" option should add that themselves and
  // pass undefined to setLayerTheme() for it, rather than the literal
  // string "default".
  getThemeNames(): string[] {
    return Object.keys(nxMapThemes);
  }

  // Changes ONE layer's theme override at runtime — e.g. a test control in
  // the layer panel, letting you try a theme without editing config JSON.
  // Mirrors exactly what initialize() does for a layer's initial theme:
  // undefined here means "inherit from the app-wide baseTheme (or
  // 'default')", same as never having set MapConfig.theme in the first
  // place. Persists onto layer.config.theme too (not just layer.theme) so
  // a later reload/rebuildMap() that re-reads configs doesn't silently
  // revert it — though today's reload path (rebuildMap()) rebuilds configs
  // from scratch anyway and would reset this regardless; call sites should
  // follow this with builder.refresh(mapOptions) + a render() to actually
  // repaint, same as every other runtime toggle in this service.
  setLayerTheme(layerIndex: number, themeName: string | undefined): void {
    const layer = this.layers[layerIndex];
    if (!layer) {
      return;
    }
    layer.config.theme = themeName;
    layer.theme = this.resolveTheme(themeName ?? this.baseTheme);
  }

  private visibleGroups(layer: LayerState): MapGroup[] {
    return layer.groups.filter(g => g.visible);
  }

  // Flattens a group's nested marker hierarchy (e.g. "Surface DALEEL" nested
  // under "AL GHUBAR - surface") into a single sibling list. Each point in
  // the source JSON already carries its own name/lat/long, so children are
  // NOT merged with parent fields — only pulled out of `points` and returned
  // alongside their parent as independent markers.
  private flattenPointHierarchy(points: MapPoint[]): MapPoint[] {
    return points.flatMap(point => {
      if (point.latitude == null || point.longitude == null) {
        console.warn(
          `[NXMap] Invalid point '${point.name ?? ""}'. latitude and longitude are required.`,
          point
        );
        return [];
      }

      const { points: children, ...rest } = point;
      const flattened: MapPoint = { ...rest, name: rest.name ?? "" };

      return [
        flattened,
        ...(children?.length ? this.flattenPointHierarchy(children) : [])
      ];
    });
  }

  // Every real MarkerShape value, for case-insensitive matching below —
  // computed once rather than on every call.
  private static readonly KNOWN_SHAPES = Object.values(MarkerShape);

  // Normalizes a shape value's casing so "circle"/"CIRCLE"/"cIrClE" etc.
  // coming from external config (inline JSON, a fetched file, or a live
  // API) all match Syncfusion's PascalCase MarkerShape values ("Circle",
  // "Diamond", ..., "InvertedTriangle") regardless of how the source data
  // happened to send it. Matched case-insensitively against the REAL enum
  // values rather than just capitalizing the first letter — a naive
  // "capitalize first, lowercase the rest" would turn "invertedtriangle"
  // into "Invertedtriangle", missing InvertedTriangle's internal capital
  // T. A shape that doesn't match any known value at all (a typo, or a
  // genuinely custom name) falls back to that same simple normalization
  // rather than silently dropping it. Applied to the FINAL resolved shape
  // (after the point/group/theme fallback chain), not to each individual
  // source, so only one normalization ever happens per marker.
  private capitalizeShape(shape: string | undefined): MarkerShape | undefined {
    if (!shape) {
      return undefined;
    }
    const known = NXMapBuilderService.KNOWN_SHAPES.find(s => s.toLowerCase() === shape.toLowerCase());
    return (known ?? shape.charAt(0).toUpperCase() + shape.slice(1).toLowerCase()) as MarkerShape;
  }

  // theme is the layer's own resolved MapTheme (see resolveTheme());
  // groupStyle is this point's OWN group's markerConfig.style. Precedence,
  // most specific wins: the point's own field, then its group's
  // markerConfig.style, then the theme's marker style, then a last-resort
  // literal (kept here in case a theme registry entry itself omits that
  // field too). groupStyle sits between the point and the theme rather
  // than being skipped entirely — a group that sets its own style should
  // apply to every point in it that doesn't override that field itself,
  // same as it already visibly does for the group's own aggregate
  // MarkerSettingsModel in buildMarkerPoints() below.
  private toMarker(point: MapPoint, lookupKey: string, theme: MapTheme, groupStyle: ShapeStyle | undefined) {
    const marker: Record<string, unknown> = {
      latitude: point.latitude,
      longitude: point.longitude,
      name: point.name,
      // Consumed by the #marker-label-template element (see
      // buildMarkerPoints()'s activeMetricId overlay branch) — "name<br>value"
      // when a reading is present, just the name otherwise. Syncfusion's
      // marker rendering has no built-in always-visible label field (unlike
      // the layer-level dataLabelSettings used for shape/region names —
      // confirmed against MarkerSettingsModel's own .d.ts, it isn't there),
      // so this only does anything for the overlay layer rendered via that
      // template.
      label: point.value === undefined ? point.name : `${point.name ?? ""}<br>${point.value}${point.unit ? " " + point.unit : ""}`,
      shape: this.capitalizeShape(point.shape ?? groupStyle?.shape ?? theme.marker?.shape ?? MarkerShape.Balloon),
      color: point.color ?? groupStyle?.color ?? theme.marker?.color,
      width: point.width ?? groupStyle?.width ?? theme.marker?.width ?? 20,
      height: point.height ?? groupStyle?.height ?? theme.marker?.height ?? 20,
      __lookupKey: lookupKey
    };

    // Flat v_/u_/c_/v2_/u2_/d2_/v3_/u3_/d3_<key> fields for
    // #marker-tooltip-template — Syncfusion's template is plain ${field}
    // substitution with no loops/conditionals, so every metric key the
    // template currently has a tile for (this.tooltipMetricKeys — see its
    // own comment) needs its own set of fields pre-populated, or the
    // template renders the literal "${v_tvp}" placeholder text. Key list is
    // data-driven now (NxMapDemoComponent.loadMap() feeds it in from
    // whatever MapConfig.tooltipTemplate.items a layer's own config
    // declares), not a hardcoded id list here — add a new metric id to a
    // layer's tooltipTemplate and its field slot exists automatically, no
    // code change. Per key: point.tooltipMetrics?.[key] (set by
    // NxMapDemoComponent.applyMetricSelection() from a matched
    // MetricOverlayRecord.tooltip — see its own comment) supplies a real
    // reading when this point has one; otherwise every tile still renders
    // the "—" placeholder, same as before any metric data existed anywhere.
    // d2_<key>/d3_<key> stay a CSS `display` value, "none" unless value2/
    // value3 is actually present (PointMetric's own optional second/third
    // line — see its comment).
    for (const key of this.tooltipMetricKeys) {
      const reading = point.tooltipMetrics?.[key];
      marker[`v_${key}`] = reading ? reading.value : "—";
      marker[`u_${key}`] = reading?.unit ?? "";
      marker[`c_${key}`] = reading?.status === "high" ? METRIC_COLORS[key] ?? NORMAL_LABEL_COLOR : "#9aa0a6";
      marker[`v2_${key}`] = reading?.value2 ?? "";
      marker[`u2_${key}`] = reading?.unit2 ?? "";
      marker[`d2_${key}`] = reading?.value2 !== undefined ? "block" : "none";
      marker[`v3_${key}`] = reading?.value3 ?? "";
      marker[`u3_${key}`] = reading?.unit3 ?? "";
      marker[`d3_${key}`] = reading?.value3 !== undefined ? "block" : "none";
    }

    return marker;
  }

  // Overlay-only marker datum for a group's activeMetricId — same
  // latitude/longitude/name as toMarker(), but label/color are computed
  // from THIS metric's own reading rather than the point's generic
  // value/color, per buildMarkerPoints()'s comment. `fetchedValues` is
  // MapGroup.activeMetricValues — the freshly-fetched response from
  // NXMapConfigService.loadMetricOverlay(), keyed by point id — the only
  // source, no static fallback (a point with no entry here just renders
  // with no overlay reading, same as any other absent value).
  private toMetricOverlayMarker(
    point: MapPoint,
    lookupKey: string,
    metricId: string,
    fetchedValues: Record<string, PointMetric> | null | undefined,
    impactStyle: MapGroup["impactMarkerStyle"] | undefined
  ) {
    const reading = point.id ? fetchedValues?.[point.id] : undefined;
    const isHigh = reading?.status === "high";
    // Resolution order, most specific wins: this group's own
    // impactMarkerStyle[reading.impact] entry -> DEFAULT_IMPACT_SHAPES for
    // that impact -> plain circle (a "normal" reading, or a "high" one that
    // somehow has no impact value, never differentiates by shape). Color
    // follows the same per-impact override, falling back to
    // METRIC_COLORS/NORMAL_LABEL_COLOR exactly as before impact styling
    // existed.
    const configuredStyle = isHigh && reading?.impact ? impactStyle?.[reading.impact] : undefined;
    const iconShape = isHigh && reading?.impact ? configuredStyle?.shape ?? DEFAULT_IMPACT_SHAPES[reading.impact] : "circle";
    const color = isHigh ? configuredStyle?.color ?? METRIC_COLORS[metricId] ?? NORMAL_LABEL_COLOR : NORMAL_LABEL_COLOR;

    return {
      latitude: point.latitude,
      longitude: point.longitude,
      label: reading ? `${point.name ?? ""}<br>${reading.value}${reading.unit ? " " + reading.unit : ""}` : point.name,
      color,
      iconShape,
      __lookupKey: lookupKey
    };
  }

  // Creating marker points for Syncfusion — one base MarkerSettingsModel
  // entry per visible group in this layer (shape/color/cluster rendering,
  // always present, unaffected by any donut selection), PLUS one extra
  // overlay entry for a group whose activeMetricId is set (persistent
  // value labels for that metric, colored per point — see
  // toMetricOverlayMarker()). flatMap rather than map so a group can
  // contribute either one or two MarkerSettingsModel entries.
  private buildMarkerPoints(layerIndex: number): MarkerSettingsModel[] {
    const layer = this.layers[layerIndex];

    return this.visibleGroups(layer).flatMap(g => {
      // Each group resolves its OWN theme (falling back to the layer's) —
      // not just the layer's theme directly — so a sub-layer API group
      // carrying its own `theme` field picks its own look independent of
      // whatever layer it got merged into. See resolveGroupTheme().
      const theme = this.resolveGroupTheme(g, layer.theme);

      // A group's own points array may include markers individually hidden
      // via the tree UI (point.visible === false) — everything else in
      // MapPoint defaults to visible when the flag is simply absent. Also
      // drops any point whose own minZoomLevel (falling back to its
      // group's g.minZoomLevel — point-level wins when both are set, same
      // "most specific wins" precedence as style/theme elsewhere in this
      // class) is above the map's current zoom (this.currentZoomLevel,
      // via setZoomLevel()) — e.g. a "well" point that should only appear
      // once zoomed in close enough to actually make sense. Neither field
      // set on either level is the same as always visible, exactly as
      // before minZoomLevel existed.
      const points = (g.markerConfig?.points ?? [])
        .filter(p => p.visible !== false)
        .filter(p => this.currentZoomLevel >= (p.minZoomLevel ?? g.minZoomLevel ?? -Infinity));

      const dataSource = points.map((point, index) => {
        const lookupKey = `${layerIndex}:${g.id}:${index}`;
        this.markerLookup.set(lookupKey, {
          type: GraphicType.Marker,
          groupId: g.id,
          groupName: g.name,
          object: point
        });
        return this.toMarker(point, lookupKey, theme, g.markerConfig?.style);
      });

      // #marker-tooltip-template (nx-map-demo.component.ts) — the hover card
      // — always applies to the base layer below.
      const tooltipSettings = { visible: true, template: "#marker-tooltip-template" };

      const baseLayer: MarkerSettingsModel = {
        visible: g.visible ?? true,
        animationDuration: 0,
        shape: this.capitalizeShape(g.markerConfig?.style?.shape ?? theme.marker?.shape),
        fill: g.markerConfig?.style?.color ?? theme.marker?.color,
        width: g.markerConfig?.style?.width ?? theme.marker?.width,
        height: g.markerConfig?.style?.height ?? theme.marker?.height,
        border: {
          width: theme.marker?.border?.width ?? 1,
          color: theme.marker?.border?.color ?? "#285255"
        },
        tooltipSettings,
        widthValuePath: "width",
        heightValuePath: "height",
        latitudeValuePath: "latitude",
        longitudeValuePath: "longitude",
        shapeValuePath: "shape",
        colorValuePath: "color",
        // Syncfusion's per-marker-layer clustering property is
        // `clusterSettings` (NOT `markerClusterSettings` — that one only
        // exists on LayerSettingsModel, one per whole layer).
        clusterSettings: this.mergeClusterConfig(g.markerConfig?.clusterConfig, theme.cluster),
        dataSource
      };

      if (!g.activeMetricId) {
        return [baseLayer];
      }

      // Overlay layer for the currently-selected donut metric — covers the
      // SAME full point list (every mol point carries every metric), not a
      // filtered subset, per applyDonutSelectionChange()'s "no new markers, no
      // markers dropped" design. `template` fully replaces Syncfusion's own
      // shape/color/cluster rendering for THIS second layer only — the base
      // layer above still renders normally underneath it. Clustering is
      // intentionally left off: it isn't designed to combine with template
      // markers.
      const metricId = g.activeMetricId;
      const overlayDataSource = points.map((point, index) =>
        this.toMetricOverlayMarker(point, `${layerIndex}:${g.id}:metric:${index}`, metricId, g.activeMetricValues, g.impactMarkerStyle)
      );

      const overlayLayer: MarkerSettingsModel = {
        visible: g.visible ?? true,
        animationDuration: 0,
        template: "#marker-label-template",
        tooltipSettings,
        latitudeValuePath: "latitude",
        longitudeValuePath: "longitude",
        dataSource: overlayDataSource
      };

      return [baseLayer, overlayLayer];
    });
  }

  // Shallow-merges a group's own clusterConfig over the layer theme's
  // cluster defaults (including the nested labelStyle, merged the same
  // way) — inline fields always win, an omitted field falls back to the
  // theme. Returns undefined only when NEITHER supplies anything, so a
  // group/theme with no clustering intent still renders with no
  // clusterSettings at all, same as before this merge existed.
  private mergeClusterConfig(
    inline: ClusterConfig | undefined,
    themeCluster: MapTheme["cluster"] | undefined
  ): ClusterConfig | undefined {
    if (!inline && !themeCluster) {
      return undefined;
    }
    return {
      allowClustering: inline?.allowClustering,
      allowDeepClustering: inline?.allowDeepClustering,
      allowClusterExpand: inline?.allowClusterExpand,
      imageUrl: inline?.imageUrl,
      shape: this.capitalizeShape(inline?.shape ?? themeCluster?.shape),
      color: inline?.color ?? themeCluster?.color,
      width: inline?.width ?? themeCluster?.width,
      height: inline?.height ?? themeCluster?.height,
      labelStyle: inline?.labelStyle ?? themeCluster?.labelStyle
    };
  }

  // Every marker id -> its coordinates, across ALL of this layer's groups
  // (not just one group) — so a line can connect markers that live in
  // different groups, e.g. a Facilities marker to a Surface marker. Built
  // fresh per call rather than cached: cheap at this data scale, and
  // guarantees it reflects whatever's currently in layer.groups even if a
  // reload/rebuild changed marker ids since the last build. Includes markers
  // from groups that are currently toggled off — a line's own visibility is
  // independent of whether its endpoint marker's group happens to be
  // checked, so an invisible group shouldn't make its markers unresolvable.
  private buildPointIdLookup(layer: LayerState): Map<string, GeoLocation> {
    const lookup = new Map<string, GeoLocation>();
    layer.groups.forEach(g => {
      (g.markerConfig?.points ?? []).forEach(p => {
        if (p.id && p.latitude != null && p.longitude != null) {
          lookup.set(p.id, { latitude: p.latitude, longitude: p.longitude });
        }
      });
    });
    return lookup;
  }

  // line.pointIds (when set) takes precedence over line.points — resolves
  // each id against the layer-wide marker lookup above. An id with no
  // matching marker logs a warning and is skipped (that one waypoint is
  // dropped, not the whole line), same style as flattenPointHierarchy's
  // existing invalid-point warning.
  private resolveLinePoints(line: MapLine, pointLookup: Map<string, GeoLocation>): GeoLocation[] {
    if (line.pointIds?.length) {
      return line.pointIds.flatMap(id => {
        const location = pointLookup.get(id);
        if (!location) {
          console.warn(`[NXMap] Line references unknown point id "${id}" — skipping this waypoint.`, line);
          return [];
        }
        return [location];
      });
    }
    return line.points ?? [];
  }

  private buildNavigationLines(layerIndex: number) {
    const layer = this.layers[layerIndex];
    const pointLookup = this.buildPointIdLookup(layer);

    return this.visibleGroups(layer)
      .flatMap(g => (g.lines ?? []).filter(l => l.visible !== false).map(line => ({ line, g })))
      .map(({ line, g }) => {
        // Resolved per-group (see buildMarkerPoints' comment) rather than
        // once for the whole layer, so a sub-layer API group's own theme
        // reaches its lines too.
        const theme = this.resolveGroupTheme(g, layer.theme).line;
        const resolvedPoints = this.resolveLinePoints(line, pointLookup);
        return {
          visible: line.visible,
          color: line.color ?? theme?.color,
          width: line.width ?? theme?.width,
          dashArray: line.dashArray ?? theme?.dashArray,
          latitude: resolvedPoints.map(x => x.latitude),
          longitude: resolvedPoints.map(x => x.longitude)
        };
      });
  }

  private buildPolygon(layerIndex: number) {
    const layer = this.layers[layerIndex];
    const theme = layer.theme;
    const lookup: GraphicLookup[] = [];
    this.polygonLookup[layerIndex] = lookup;

    const polygons: any[] = [];

    // Circles are rendered as polygons in Syncfusion Maps, so they share
    // one flat array (and one lookup) with real polygons — Syncfusion
    // paints polygons[] in array order, later entries on top of earlier
    // ones. Real polygons are pushed FIRST and circles LAST so a circle
    // whose center sits inside/on a polygon (a common case — marking a
    // point of interest that's already within a named region) still
    // renders on top instead of being painted over by the region's fill.
    layer.groups
      .filter(g => g.visible)
      .flatMap(g => (g.polygons ?? []).filter(p => p.visible !== false).map(polygon => ({ polygon, g })))
      .forEach(({ polygon, g }) => {
        // Per-group, same reasoning as buildMarkerPoints/buildNavigationLines.
        const groupTheme = this.resolveGroupTheme(g, theme);
        polygons.push({
          tooltipText: polygon.name,
          points: polygon.points,
          fill: polygon.background ?? groupTheme.polygon?.background ?? "red",
          opacity: polygon.opacity ?? groupTheme.polygon?.opacity ?? 0.7,
          borderColor: polygon.borderColor ?? groupTheme.polygon?.borderColor ?? "green",
          borderWidth: polygon.borderWidth ?? groupTheme.polygon?.borderWidth ?? 2
        });
        lookup.push({
          type: GraphicType.Polygon,
          groupId: g.id,
          groupName: g.name,
          object: polygon
        });
      });

    layer.groups
      .filter(g => g.visible)
      .flatMap(g => (g.circles ?? []).filter(c => c.visible !== false).map(circle => ({ circle, g })))
      .forEach(({ circle, g }) => {
        const groupTheme = this.resolveGroupTheme(g, theme);
        // circleToPolygon() already resolves fill/opacity/border against
        // groupTheme.circle (and its own last-resort literals) internally,
        // so `constructed`'s fields are used as-is here — no second
        // fallback needed at this call site.
        const constructed = this.circleToPolygon(circle, groupTheme.circle);
        if (!constructed) {
          return;
        }
        polygons.push({
          tooltipText: constructed.name,
          points: constructed.points,
          fill: constructed.background,
          opacity: constructed.opacity,
          borderColor: constructed.borderColor,
          borderWidth: constructed.borderWidth
        });
        lookup.push({
          type: GraphicType.Circle,
          groupId: g.id,
          groupName: g.name,
          object: circle
        });
      });

    return {
      // Layer-level only, deliberately not resolved per-group: Syncfusion's
      // polygonSettings.tooltipSettings is a single object for the whole
      // layer, not one per group, so a group-level theme override has
      // nowhere to apply here even though it does for fill/opacity/border
      // above.
      tooltipSettings: {
        visible: true,
        border: {
          width: theme.tooltip?.border?.width ?? 2,
          color: theme.tooltip?.border?.color ?? "red"
        }
      },
      polygons
    };
  }

  private circleToPolygon(circle: MapCircle, circleTheme: MapThemeFill | undefined): MapPolygon {
    const points: GeoLocation[] = [];

    const segments = circle.segments ?? 64;
    const earthRadius = 6378137; // meters

    const lat = (circle.center.latitude * Math.PI) / 180;
    const lng = (circle.center.longitude * Math.PI) / 180;

    for (let i = 0; i <= segments; i++) {
      const bearing = (2 * Math.PI * i) / segments;
      const angularDistance = circle.radius / earthRadius;

      const lat2 = Math.asin(
        Math.sin(lat) * Math.cos(angularDistance) +
          Math.cos(lat) * Math.sin(angularDistance) * Math.cos(bearing)
      );

      const lng2 =
        lng +
        Math.atan2(
          Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat),
          Math.cos(angularDistance) - Math.sin(lat) * Math.sin(lat2)
        );

      points.push({
        latitude: (lat2 * 180) / Math.PI,
        longitude: (lng2 * 180) / Math.PI
      });
    }

    return {
      name: circle.name,
      background: circle.background ?? circleTheme?.background ?? "red",
      opacity: circle.opacity ?? circleTheme?.opacity ?? 0.7,
      borderColor: circle.borderColor ?? circleTheme?.borderColor ?? "green",
      borderWidth: circle.borderWidth ?? circleTheme?.borderWidth ?? 2,
      points
    };
  }

  // Toggles a group by id across ALL layers. If two layers happen to reuse
  // the same group id (e.g. "facility" in both an Oman layer and a Musandam
  // layer), this shows/hides it in both simultaneously — key groups
  // "<layerName>:<groupId>" instead when per-region toggling is needed.
  showGroups(ids: string[]) {
    this.layers.forEach(layer => {
      layer.groups.forEach(g => {
        g.visible = ids.includes(g.id);
      });
    });
  }

  // Hides/shows an entire Syncfusion layer — its shapeData/boundary AND
  // every group inside it — distinct from showGroups()/a group's own
  // `visible`, which only ever affects markers/lines/polygons within a
  // layer that stays on the map. The main layer can't be hidden this way —
  // every other layer's groups/markers render relative to it, so turning
  // it off would leave nothing on the map at all. Enforced here too (not
  // just via a disabled checkbox) in case a caller invokes this directly.
  setLayerVisible(layerIndex: number, visible: boolean): void {
    if (layerIndex === this.mainLayerIndex && !visible) {
      console.warn("[NXMap] The main layer can't be hidden.");
      return;
    }
    const layer = this.layers[layerIndex];
    if (layer) {
      layer.visible = visible;
    }
  }

  // Builds the data the layer-control tree UI renders: one node per
  // "root" layer (a layer with no parentLayerName, or whose parent isn't
  // among the loaded layers), each with its groups/headings and, in
  // `children`, every other layer nested under it in the filter popup. A
  // consumer toggles visibility at any level by mutating `.visible`
  // directly on these same objects (groups/items) or via
  // setLayerVisible() (layers, since `visible` there is a plain boolean
  // field on internal state, not an object reference), then calls
  // refresh(). Layers with config.participateInFilter === false still
  // render on the map but are omitted from this tree entirely — no toggle
  // offered for them.
  getLayerTree(): (LayerTreeNode | LayerRegionNode)[] {
    const nodes = this.layers
      .map((layer, layerIndex) => (layer.config.participateInFilter === false ? null : this.buildTreeNode(layer, layerIndex)))
      .filter((node): node is LayerTreeNode => node !== null);

    const nodesByLayerName = new Map(nodes.map(node => [node.layerName, node]));

    // Flat (ungrouped) children per node, keyed by layerName — nestedLayerNames
    // below needs the raw layer names before groupLayersByRegion() folds some
    // of them into LayerRegionNode buckets that no longer carry a layerName.
    const flatChildren = new Map<string, LayerTreeNode[]>(nodes.map(node => [node.layerName, []]));

    nodes.forEach(node => {
      const parentName = this.layers[node.layerIndex].config.parentLayerName;
      const parent = parentName ? nodesByLayerName.get(parentName) : undefined;
      if (parent && parent !== node) {
        flatChildren.get(parent.layerName)!.push(node);
      }
    });

    const nestedLayerNames = new Set(Array.from(flatChildren.values()).flatMap(children => children.map(child => child.layerName)));

    nodes.forEach(node => {
      node.children = this.groupLayersByRegion(flatChildren.get(node.layerName) ?? []);
    });

    const roots = nodes.filter(node => !nestedLayerNames.has(node.layerName));
    return this.groupLayersByRegion(roots);
  }

  // Buckets a flat sibling list into LayerRegionNode folders wherever
  // MapConfig.region is set, in first-seen region order — same pattern as
  // buildTreeNode()'s heading/shapeFeatureGroup bucketing, one level up. A
  // node whose layer has no `region` stays a direct entry, in its original
  // position, exactly as before regions existed.
  private groupLayersByRegion(nodes: LayerTreeNode[]): (LayerTreeNode | LayerRegionNode)[] {
    const result: (LayerTreeNode | LayerRegionNode)[] = [];
    const regionNodes = new Map<string, LayerRegionNode>();

    nodes.forEach(node => {
      const region = this.layers[node.layerIndex].config.region;
      if (!region) {
        result.push(node);
        return;
      }
      let regionNode = regionNodes.get(region);
      if (!regionNode) {
        regionNode = { region, layers: [] };
        regionNodes.set(region, regionNode);
        result.push(regionNode);
      }
      regionNode.layers.push(node);
    });

    return result;
  }

  private buildTreeNode(layer: LayerState, layerIndex: number): LayerTreeNode {
    const groups: GroupEntry[] = [];
    const headingOrder: string[] = [];
    const headingGroups = new Map<string, GroupEntry[]>();

    layer.groups.forEach(group => {
      const entry: GroupEntry = {
        group,
        markers: group.markerConfig?.points ?? [],
        polygons: group.polygons ?? [],
        circles: group.circles ?? [],
        lines: group.lines ?? []
      };

      if (group.heading) {
        if (!headingGroups.has(group.heading)) {
          headingOrder.push(group.heading);
          headingGroups.set(group.heading, []);
        }
        headingGroups.get(group.heading)!.push(entry);
      } else {
        groups.push(entry);
      }
    });

    // Opt-in per MapConfig.shapeFeaturesSelectable — a layer that doesn't set
    // it keeps the pre-existing single-checkbox behavior, even when its
    // shapeData happens to have multiple features. Also gated on more than
    // one feature: a single-feature shape (e.g. MOL's own boundary, whose
    // one feature is literally named "MOL" — the same as the layer's own
    // title) would otherwise nest a redundant child row under the layer
    // duplicating its own label, when the layer's own checkbox already
    // covers that one feature completely.
    const rawFeatures = layer.shapeData?.features ?? [];
    const shapeFeatures: ShapeFeatureEntry[] = [];
    const regionOrder: string[] = [];
    const regionFeatures = new Map<string, ShapeFeatureEntry[]>();
    if (layer.config.shapeFeaturesSelectable && rawFeatures.length > 1) {
      rawFeatures.forEach((feature: any, index: number) => {
        const entry: ShapeFeatureEntry = {
          index,
          name: feature?.properties?.name ?? feature?.properties?.id ?? `Shape ${index + 1}`,
          visible: layer.shapeFeatureVisible[index] !== false
        };
        const region = feature?.properties?.region;
        if (region) {
          if (!regionFeatures.has(region)) {
            regionOrder.push(region);
            regionFeatures.set(region, []);
          }
          regionFeatures.get(region)!.push(entry);
        } else {
          shapeFeatures.push(entry);
        }
      });
    }

    return {
      layerIndex,
      layerName: layer.config.layerName,
      displayName: layer.config.title?.text ?? layer.config.layerName,
      visible: layer.visible,
      isMainLayer: layerIndex === this.mainLayerIndex,
      groups,
      headings: headingOrder.map(heading => ({ heading, groups: headingGroups.get(heading)! })),
      children: [],
      shapeFeatures,
      shapeFeatureGroups: regionOrder.map(region => ({ region, features: regionFeatures.get(region)! })),
      themeName: layer.config.theme
    };
  }

  // Runtime toggle for one shapeData feature (e.g. one of Al Wusta's
  // clusters) — mirrors setLayerTheme()'s pattern: mutate this.layers state,
  // then the caller follows up with refresh(mapOptions) + render() to
  // actually repaint, same as every other toggle in this service.
  setShapeFeatureVisible(layerIndex: number, featureIndex: number, visible: boolean): void {
    const layer = this.layers[layerIndex];
    if (!layer) {
      return;
    }
    layer.shapeFeatureVisible[featureIndex] = visible;
  }

  refresh(mapOptions: MapOptions) {
    // Reassign (not mutate) layers so Syncfusion's change detection on the
    // e-layer directives actually picks up the new settings, for every
    // layer — not just the first.
    //
    // `visible` is ALWAYS true here, regardless of this.layers[layerIndex]'s
    // own flag — confirmed live: feeding Syncfusion's OWN layer `visible:
    // false` makes it drop that entry from its internal layersCollection
    // entirely and renumber every LATER layer's rendered "_LayerIndex_<n>"
    // DOM id down by one. Since nx-map-demo.component.ts's
    // syncLayerDomVisibility() hides layers by walking this same
    // mapOptions.layers array BY POSITION and matching it against
    // "_LayerIndex_<i>" in the DOM, that renumbering makes it toggle the
    // WRONG (now-shifted) layer's shape off — visually, unchecking one
    // layer also hides whichever layer used to sit right after it. Keeping
    // Syncfusion's own flag pinned to true keeps layersCollection's length
    // and numbering stable; getLayerVisible() below is the real (indexable)
    // source of truth syncLayerDomVisibility() should use instead.
    // `layerIndex` (the .map() position) is where Syncfusion PAINTS this
    // entry, which buildLayers() can reorder away from the original
    // this.layers index (see its own comment, and renderOrder's) — every
    // this.layers[...]/buildMarkerPoints()/buildNavigationLines()/
    // buildPolygon() lookup below MUST go through renderOrder to land on
    // the layer actually rendered at this position, not this.layers[layerIndex]
    // directly. Confirmed live: without this translation, a toggle-
    // triggered refresh() rebuilds each position's markers/lines/polygons
    // from the WRONG layer whenever paint order and declared order
    // diverge — e.g. unchecking a marker-less layer that got reordered
    // ahead of a marker-bearing one silently wiped that marker-bearing
    // layer's markers out of the map, only "fixed" by whatever next
    // triggered a full buildMap() (which recomputes renderOrder AND
    // markerSettings together, so they can't drift apart).
    mapOptions.layers = mapOptions.layers.map((existing, layerIndex) => {
      const originalIndex = this.renderOrder[layerIndex] ?? layerIndex;
      const layer = this.layers[originalIndex];
      const isMain = originalIndex === this.mainLayerIndex;
      // Only the main layer can ever change baseMapType at runtime (see
      // setBaseMapType()) — recomputing the full shapeData/urlTemplate/
      // shapeSettings/dataLabelSettings set for every OTHER layer here would
      // just re-derive the same values buildLayers() already gave them.
      // theme-driven fill changes for non-main layers are still patched
      // below, same as before.
      if (isMain) {
        return {
          ...existing,
          ...this.buildBaseMapFields(layer, isMain),
          visible: true,
          markerSettings: this.buildMarkerPoints(originalIndex),
          navigationLineSettings: this.buildNavigationLines(originalIndex),
          polygonSettings: this.buildPolygon(originalIndex)
        };
      }
      return {
        ...existing,
        visible: true,
        // shapeData itself is otherwise only ever built once, in
        // buildLayers() — re-derived here too (cheap: just an array filter)
        // so a runtime per-feature toggle (toggleShapeFeature()) actually
        // repaints a non-main layer's shape without needing a full
        // buildMap(). undefined for a tile layer (shapeData itself is
        // undefined there), so nothing to recompute.
        shapeData: existing.shapeData ? this.visibleShapeData(layer) : existing.shapeData,
        // shapeSettings itself was only ever built once, in buildLayers() —
        // a runtime theme change (e.g. the layer panel's theme <select>)
        // otherwise never touched it at all, so layer.background/border/
        // theme.layer.background/borderColor/borderWidth changes silently
        // had no visible effect until the NEXT full buildMap(). Only
        // fill/border are recomputed here (via the same
        // resolveLayerBackground()/resolveLayerBorder() buildLayers()
        // uses) — palette/autofill don't depend on anything themeable
        // today. undefined for a tile layer (shapeSettings itself is
        // undefined there), so nothing to patch.
        shapeSettings: existing.shapeSettings
          ? { ...existing.shapeSettings, fill: this.resolveLayerBackground(layer, isMain), border: this.resolveLayerBorder(layer) }
          : existing.shapeSettings,
        markerSettings: this.buildMarkerPoints(originalIndex),
        navigationLineSettings: this.buildNavigationLines(originalIndex),
        polygonSettings: this.buildPolygon(originalIndex)
      };
    });
  }

  private isTileBaseMapType(type: MapConfig["baseMapType"]): type is "osm" | "satellite" {
    return type === "osm" || type === "satellite";
  }

  private resolveTileUrl(type: MapConfig["baseMapType"]): string | undefined {
    return this.isTileBaseMapType(type) ? TILE_URL_TEMPLATES[type] : undefined;
  }

  // Swaps the main layer's base map style at runtime (e.g. a "Simple" /
  // "Map" / "Satellite" UI toggle) — "shape" falls back to whatever
  // shapeData was already resolved for this layer at initialize() time
  // (fetched regardless of the config's original baseMapType — see
  // NXMapConfigService.resolveShapeData()), so switching TO "shape" needs no
  // extra fetch even when the layer started tile-based. If that shapeData
  // never resolved (no shapeDataSource and no SHAPE_DATA_BY_LAYER_NAME
  // fallback — already warned about at load time), the layer just renders
  // with no boundary, same as any other layer with no shapeData. Only
  // updates this.layers' own config — call refresh() afterwards to push the
  // change onto mapOptions and re-render.
  setBaseMapType(type: "shape" | "osm" | "satellite"): void {
    const layer = this.layers[this.mainLayerIndex];
    if (!layer) {
      return;
    }
    layer.config.baseMapType = type;
  }

  // The main layer's current baseMapType — "shape" (or undefined, its
  // default) means it's shapeData-driven, "osm"/"satellite" mean it's
  // tile-based.
  getBaseMapType(): MapConfig["baseMapType"] {
    return this.layers[this.mainLayerIndex]?.config.baseMapType;
  }

  // this layer's own shapeSettings.fill — the layer's config.background
  // always wins, then the theme's layer.background, then the original
  // hardcoded default (opaque grey for the main layer, translucent blue for
  // any SubLayer). Shared by buildLayers() (initial build) and refresh()
  // (so a runtime theme change actually repaints it, not just future
  // rebuilds) so there's exactly one place this precedence is encoded.
  private resolveLayerBackground(layer: LayerState, isMain: boolean): string {
    return layer.config.background ?? layer.theme.layer?.background ?? (isMain ? "#dddddd" : "rgba(66, 133, 244, 0.25)");
  }

  // Same precedence as resolveLayerBackground() above, for the layer's own
  // shapeSettings.border — config.borderColor/borderWidth wins, then the
  // theme's layer.borderColor/borderWidth, then the original hardcoded
  // default (a thin #A6A6A6 line). Independent of fill/background, so a
  // layer can go border-only (background: "transparent") without losing
  // its outline.
  private resolveLayerBorder(layer: LayerState): { width: number; color: string } {
    return {
      width: layer.config.borderWidth ?? layer.theme.layer?.borderWidth ?? 0.1,
      color: layer.config.borderColor ?? layer.theme.layer?.borderColor ?? "#A6A6A6"
    };
  }

  // The real per-layer visibility flag — NOT mirrored onto Syncfusion's own
  // mapOptions.layers[i].visible (see refresh() above for why). Callers that
  // need to know whether a layer is actually supposed to be hidden (e.g.
  // syncLayerDomVisibility()'s DOM-level display:none toggle) should read
  // this instead of the Syncfusion-bound layer settings.
  getLayerVisible(layerIndex: number): boolean {
    return this.layers[layerIndex]?.visible ?? true;
  }

  // configs: one entry per Syncfusion layer. shapeDataByLayer: that layer's
  // GeoJSON, keyed by config.layerName (e.g. from NXMapDataService — fetch
  // one per layerName and forkJoin them before calling this). baseTheme:
  // NXMapAppConfig.theme — the app-wide default every layer inherits unless
  // it sets its own MapConfig.theme.
  buildMap(configs: MapConfig[], shapeDataByLayer: Record<string, any>, baseTheme?: string): MapOptions {
    this.initialize(configs, shapeDataByLayer, baseTheme);
    // Index into this.layers (post-filter), NOT the raw configs param —
    // visible: false entries may have been dropped, shifting indices.
    const mainConfig = this.layers[this.mainLayerIndex].config;
    return {
      // titleSettings/zoomSettings/centerPosition are MapOptions-level in
      // Syncfusion (not per-layer), so only the MAIN config's title/zoom/
      // center apply — configs[0], always (see MapConfig's own comment).
      titleSettings: this.buildTitle(mainConfig),
      zoomSettings: this.buildZoom(mainConfig),
      // Same as zoomFactor in buildZoom() — always taken from config
      // regardless of baseMapType.
      centerPosition: mainConfig.mapCenter,
      layers: this.buildLayers()
    } as MapOptions;
  }

  getMainLayerIndex(): number {
    return this.mainLayerIndex;
  }

  // Every OTHER computation keyed by layerIndex (buildMarkerPoints(),
  // markerLookup's "${layerIndex}:${g.id}:..." keys, getLayerTree(), the
  // toggle handlers in nx-map-demo.component.ts) stays anchored to
  // this.layers' own index order — that order is exactly how the caller's
  // config declared its static layers (see NxMapDemoComponent.rebuildMap()),
  // and it's what the filter-tree panel displays them in, so it must NOT
  // change here. What DOES need to change independently is PAINT order:
  // Syncfusion stacks entries in this returned array's OWN order (later =
  // on top — see the SubLayer fill comment below), which used to just be
  // this.layers' order verbatim. Confirmed live: a non-main static layer
  // with no markers of its own (e.g. a plain administrative-boundary
  // SubLayer) declared AFTER a marker-bearing one silently ate every hover
  // event over those markers — its own shape polygon painted on top and
  // intercepted the pointer, even though the markers were still visibly
  // there underneath. Reordering ONLY this returned array (built objects
  // already carry no layerIndex-dependent state of their own past this
  // point) — main layer first (unchanged), then every other layer stably
  // partitioned so any layer with at least one marker point paints LAST,
  // on top of every marker-less one — fixes that regardless of how a
  // config's own Configuration[] happens to be ordered, without requiring
  // every deployment's JSON to get the order "right" by hand.
  buildLayers() {
    const built = this.layers.map((layer, layerIndex) => {
      const isMain = layerIndex === this.mainLayerIndex;
      // OSM/satellite tiles only render reliably as the MAIN layer. Syncfusion's
      // SubLayer type expects shapeData whose geometry aligns with the
      // base layer's coordinate system — a raster tile source (no
      // shapeData at all) doesn't fit that model, so a SubLayer configured
      // with baseMapType: "osm"/"satellite" would simply not render. Any
      // non-main layer always falls back to shape rendering regardless of
      // what its config says.
      if (this.isTileBaseMapType(layer.config.baseMapType) && !isMain) {
        console.warn(
          `[NXMap] Layer "${layer.config.layerName}" requested baseMapType: "${layer.config.baseMapType}" but isn't the main layer — falling back to shape rendering. Tile base maps (osm/satellite) only work as the main/base layer.`
        );
      }

      return {
        isMain,
        layerIndex,
        hasMarkers: layer.groups.some(g => (g.markerConfig?.points ?? []).length > 0),
        layer: {
          ...this.buildBaseMapFields(layer, isMain),
          shapePropertyPath: "name",
          // ALWAYS true here, regardless of layer.visible — same reasoning
          // as refresh()'s own `visible: true` below (see its comment):
          // feeding Syncfusion's OWN layer visible: false makes it drop
          // that entry from its internal layersCollection entirely at
          // BUILD time too, not just on a later refresh, renumbering every
          // LATER layer's "_LayerIndex_<n>" DOM id down by one — confirmed
          // live as the cause of a layer that should start unchecked
          // (MapConfig.selected: false) instead breaking EVERY layer's
          // rendering, main layer included, the very first time more than
          // one layer started unchecked. getLayerVisible()/
          // syncLayerDomVisibility() (run once after the map's own
          // `(loaded)` event — see NxMapDemoComponent.onMapLoaded()) are
          // what actually hide it, via display:none, same mechanism a
          // runtime toggle already used — this just makes the INITIAL
          // build go through that same DOM-level path instead of Syncfusion's
          // own (collection-shrinking) one.
          visible: true,
          // The main layer renders as Syncfusion's base 'Layer' type; every
          // other config becomes a 'SubLayer' stacked on top of it. If your
          // regions' shapeData geographically overlaps, keep the SubLayer's
          // fill semi-transparent (e.g. "rgba(141,206,255,0.4)") or its
          // opaque shape will visually cover the base layer's markers/
          // polygons even though they still exist underneath in the DOM.
          type: (isMain ? "Layer" : "SubLayer") as any,
          markerSettings: this.buildMarkerPoints(layerIndex),
          navigationLineSettings: this.buildNavigationLines(layerIndex),
          polygonSettings: this.buildPolygon(layerIndex)
        }
      };
    });

    const main = built.filter(b => b.isMain);
    const rest = built.filter(b => !b.isMain);
    // Array.prototype.sort is stable (guaranteed since ES2019, which every
    // browser this app targets already implements) — layers within the
    // same hasMarkers bucket keep their original relative order.
    const orderedRest = [...rest].sort((a, b) => Number(a.hasMarkers) - Number(b.hasMarkers));
    const ordered = [...main, ...orderedRest];
    this.renderOrder = ordered.map(b => b.layerIndex);
    return ordered.map(b => b.layer);
  }

  // See renderOrder's own comment — renderOrder[renderPosition] is the
  // original layerIndex to use with getLayerVisible()/other layerIndex-keyed
  // lookups for whatever DOM group Syncfusion rendered at that position.
  getRenderOrder(): number[] {
    return this.renderOrder;
  }

  // shapeData/urlTemplate/shapeSettings/dataLabelSettings all pivot on the
  // same isTile flag, so buildLayers() (initial build, every layer) and
  // refresh() (runtime base-map-style swap, main layer only) share this
  // rather than re-deriving each field from scratch in two places that could
  // drift apart. Non-main layers are never tile-based (see buildLayers()'s
  // own warning), so isTile is always false for them regardless of what
  // their config says.
  // Filters shapeData.features down to whichever ones shapeFeatureVisible
  // still marks true — a feature toggled off in the layer tree is fully
  // absent from what Syncfusion renders, not just dimmed. Returns
  // layer.shapeData untouched (including undefined/non-FeatureCollection
  // shapes) when there's nothing to filter, so this is safe to call
  // unconditionally.
  private visibleShapeData(layer: LayerState): any {
    const features = layer.shapeData?.features;
    if (!Array.isArray(features) || features.every((_f: any, i: number) => layer.shapeFeatureVisible[i] !== false)) {
      return layer.shapeData;
    }
    return {
      ...layer.shapeData,
      features: features.filter((_f: any, i: number) => layer.shapeFeatureVisible[i] !== false)
    };
  }

  private buildBaseMapFields(layer: LayerState, isMain: boolean) {
    const isTile = this.isTileBaseMapType(layer.config.baseMapType) && isMain;
    return {
      // Raster tiles and shapeData are mutually exclusive per Syncfusion —
      // urlTemplate only takes effect when shapeData is NOT set.
      shapeData: isTile ? undefined : this.visibleShapeData(layer),
      urlTemplate: isTile ? this.resolveTileUrl(layer.config.baseMapType) : undefined,
      shapeSettings: isTile
        ? undefined
        : {
            autofill: false,
            // See resolveLayerBackground() — main layer gets the opaque
            // grey by default; any SubLayer defaults to a semi-transparent
            // fill instead, since SubLayers commonly cover ground the main
            // layer already occupies (a region within the country), and an
            // opaque fill there would visually bury the main layer's own
            // markers/polygons in that area even though they still exist
            // underneath in the DOM.
            fill: this.resolveLayerBackground(layer, isMain),
            palette: [
              "#E2B247",
              "#88DB46",
              "#42C4E2",
              "#C08AF8",
              "#52BACC",
              "#F4CE2F",
              "#6986ED"
            ],
            border: this.resolveLayerBorder(layer)
          },
      // A tile layer has no named shape features to label against.
      dataLabelSettings: isTile
        ? undefined
        : {
            visible: layer.config.dataLabel?.visible ?? false,
            labelPath: "name",
            textStyle: {
              color: layer.config.dataLabel?.color ?? layer.theme.dataLabel?.color
            },
            opacity: layer.config.dataLabel?.opacity ?? layer.theme.dataLabel?.opacity
          }
    };
  }

  private buildTitle(config: MapConfig) {
    return {
      text: config.title?.text ?? "",
      titleStyle: {
        size: config.title?.titleStyle?.size || "16px"
      }
    };
  }

  private buildZoom(mainConfig: MapConfig) {
    // Tile-based (osm/satellite) main layers take zoomFactor directly from
    // config — the config is expected to set the right value to frame its
    // region in raster tiles. A "shape" main layer (default, including
    // when baseMapType is unset) always starts at zoomFactor 1 regardless
    // of what the config says — shape rendering auto-fits its own
    // shapeData bounding box, and Syncfusion's "no extra zoom" baseline
    // (1) is what lets that auto-fit actually take effect; any config
    // zoomFactor left over from switching to/from a tile style (see
    // setMapStyle()'s own comment) would otherwise start the shape view
    // zoomed in past its own boundary.
    const zoomFactor = this.isTileBaseMapType(mainConfig.baseMapType) ? mainConfig.zoomFactor ?? 1 : 1;
    // buildMap() evaluates zoomSettings (this method) before layers
    // (buildLayers() -> buildMarkerPoints()), so setting this here lands
    // BEFORE the very first buildMarkerPoints() call of this build reads
    // it — a point with a MapGroup/MapPoint.minZoomLevel above the map's
    // real starting zoom correctly starts hidden on first paint, not just
    // after the first zoomComplete (NxMapDemoComponent.onZoomComplete())
    // happens to fire and set the real value.
    this.setZoomLevel(zoomFactor);
    return {
      enable: true,
      mouseWheelZoom: true,
      enablePanning: true,
      showToolbar: true,
      zoomFactor,
      // Matches the zoomFactor floor above — 1 is the least-zoomed-out view
      // Syncfusion itself supports, so this just makes that floor explicit
      // rather than relying on Syncfusion's own default (which mouse-wheel/
      // toolbar zoom-out could otherwise undercut).
      minZoom: 1,
      // Syncfusion's OWN default (10, per ZoomSettingsModel's own doc
      // comment) silently caps how far a tile ("osm"/"satellite") main
      // layer can zoom in, regardless of what the tile provider can
      // actually serve there — confirmed live as exactly why satellite
      // mode stopped zooming well before a well/station became visible.
      // mainConfig.maxZoomFactor lets a deployment override per map; unset
      // falls back to 18, not 19 — confirmed live that 19 let the toolbar's
      // ZoomIn button take one click past what ArcGIS World Imagery
      // actually has tiles for at typical well/station locations, landing
      // on a blank "no image available" tile right as ZoomIn disabled
      // itself with nowhere further to go. 18 is the deepest level that
      // stays inside real imagery at this provider for this kind of
      // location — still far past where Syncfusion's own default (10) was
      // actually biting. A "shape" main layer's own auto-fit zoom has no
      // comparable ceiling to worry about, so this only matters for tile
      // base map types.
      maxZoom: mainConfig.maxZoomFactor ?? 18,
      // The toolbar's Reset button restores whatever centerPosition/
      // zoomFactor the map rendered with initially (our configured
      // mapCenter/zoomFactor for an "osm" main layer, or the shape's
      // auto-fit bounds otherwise) — not a separate Syncfusion default.
      resetToInitial: true,
      // Zoom in one step on double-click, in addition to the toolbar's
      // ZoomIn button and mouse-wheel zoom.
      doubleClickZoom: true
    };
  }

  // Resolves a Syncfusion `markerClick` event directly from its args — no
  // DOM-id parsing needed. IMarkerClickEventArgs.data is the exact
  // dataSource object toMarker() produced, including the __lookupKey
  // stamped onto it, so this is an O(1) lookup regardless of how many
  // layers/groups/markers are currently visible.
  resolveMarkerClick(args: { data?: { __lookupKey?: string } }): GraphicLookup | undefined {
    const key = args.data?.__lookupKey;
    return key ? this.markerLookup.get(key) : undefined;
  }

  // Resolves a Syncfusion polygon/circle click from the DOM target id.
  // UNVERIFIED against a live click in your installed Syncfusion version —
  // confirm the actual id format (console.log(args.target) on a real
  // click) before relying on this. With multiple layers each emitting their
  // own "PolygonIndex_0", "PolygonIndex_1"..., you also need the layer
  // index out of the same id (Syncfusion ids are typically of the form
  // "<mapId>_LayerIndex_<n>_...") — this currently assumes layer 0 if no
  // layer index is found in the id, which will misresolve clicks on any
  // other layer's polygons.
  resolveClickedGraphic(target: string): GraphicLookup | undefined {
    const result = this.parseTarget(target);
    if (!result) {
      return undefined;
    }
    return this.polygonLookup[result.layerIndex]?.[result.index];
  }

  private parseTarget(target: string): (ParseTargetResult & { layerIndex: number }) | null {
    const id = (target as any)?.id as string | undefined;
    const match = id?.match(/PolygonIndex_(\d+)/i);
    if (!match) {
      return null;
    }
    const layerMatch = id?.match(/LayerIndex_(\d+)/i);
    return {
      type: GraphicType.Polygon,
      index: Number(match[1]),
      layerIndex: layerMatch ? Number(layerMatch[1]) : 0
    };
  }

  // Called from NxMapDemoComponent.onShapeSelected() with the exact
  // shapeData object Syncfusion's own `shapeSelected` event hands back
  // (args.shapeData) — confirmed live that this is actually the clicked
  // feature's `properties` object (not the whole Feature), passed through
  // by REFERENCE from our own shapeData (Syncfusion never clones it), so
  // matching against each feature's `.properties` is how the click is
  // traced back to a specific feature without any id-parsing. Only matches
  // layers explicitly opted into per-polygon selection
  // (shapeFeaturesSelectable) — otherwise a click ANYWHERE on the main Oman
  // shape (or any other layer's own single boundary feature) matches THAT
  // layer's own feature.properties too (every shape layer's shapeData is a
  // FeatureCollection with properties, not just the opted-in ones) —
  // confirmed live this was why every map click was matching, not just
  // clicks on Lekhwair/Qarn Alam.
  //
  // Deliberately name-only, no zoom-to-feature: an earlier version also
  // returned a center/zoomFactor and called zoomByPosition() on click, but
  // that conflicted with Syncfusion's OWN interactive wheel-zoom state in
  // this version (confirmed live: scroll-zoom-out got stuck at the same
  // factor afterward) — see onZoomComplete()'s own comment for the same
  // class of zoomByPosition-vs-interactive-zoom desync already documented
  // there. Dropped rather than risk breaking core zoom controls.
  resolveSelectedShapeName(shapeData: any): string | undefined {
    for (const layer of this.layers) {
      if (!layer.config.shapeFeaturesSelectable) {
        continue;
      }
      const features: any[] = layer.shapeData?.features ?? [];
      const feature = features.find(f => f.properties === shapeData);
      if (feature) {
        return feature.properties?.name ?? feature.properties?.id ?? "Shape";
      }
    }
    return undefined;
  }
}
