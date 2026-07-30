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
  ParseTargetResult
} from "../model/nx-map-model";

// Bundled the same way pdo-map-config.json is in nx-map-demo.component.ts —
// a compile-time import, no HTTP round trip, so buildMap()/initialize() stay
// synchronous.
const nxMapThemes: MapThemeRegistry = ((nxMapThemesJson as any).default ?? nxMapThemesJson) as MapThemeRegistry;

interface LayerState {
  config: MapConfig;
  shapeData: any;
  groups: MapGroup[];
  // Controls the whole Syncfusion layer's `visible` flag — hides the
  // region's shape/boundary AND everything in it, distinct from a group's
  // own `visible` (which only hides that group's markers/lines/polygons
  // within a still-visible layer).
  visible: boolean;
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
  // True for whichever config has `isMainLayer: true` (or configs[0] if
  // none does) — the layer panel should disable this node's own checkbox,
  // since hiding it would leave the map with nothing to render against.
  isMainLayer: boolean;
  // Groups with no `heading` — rendered directly under this layer, same as
  // before headings existed.
  groups: GroupEntry[];
  // Groups bucketed by `heading`, in first-seen order.
  headings: HeadingNode[];
  // Other layers whose config.parentLayerName === this.layerName — e.g.
  // static layers nested under the base layer in the filter popup, even
  // though each still renders as its own independent Syncfusion SubLayer.
  children: LayerTreeNode[];
  // This layer's own theme override (MapConfig.theme), or undefined when
  // it's inheriting from the app-wide/default theme instead. Drives the
  // layer panel's theme <select> — see setLayerTheme().
  themeName: string | undefined;
}

@Injectable()
export class NXMapBuilderService {
  // One entry per Syncfusion layer (= one entry in the MapConfig[] passed to
  // buildMap). Each layer keeps its own groups, independent of the others —
  // toggling a group in one layer never touches another layer's markers.
  private layers: LayerState[] = [];

  // Keyed by "<layerIndex>:<groupId>:<pointIndex>" — the same key stamped
  // onto each marker's dataSource object as `__lookupKey` in toMarker().
  // Resolves markerClick's `data` arg in O(1) without any DOM-id parsing,
  // and the layerIndex prefix keeps two layers' same-named groups distinct.
  private markerLookup = new Map<string, GraphicLookup>();

  // One lookup array per layer, each aligned with that layer's flat
  // `polygons` array from buildPolygon() (circles pushed first, then real
  // polygons — built in that exact order so indexes always match).
  private polygonLookup: GraphicLookup[][] = [];

  // Index of the config with `isMainLayer: true`, or 0 if none is marked.
  // The main layer always renders as Syncfusion's base 'Layer' type (every
  // other config becomes a 'SubLayer'), and it's the one the layer panel
  // won't let the user turn off.
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
    const rawMainIndex = configs.findIndex(c => c.isMainLayer);
    const mainIndex = rawMainIndex === -1 ? 0 : rawMainIndex;
    if (configs[mainIndex]?.visible === false) {
      console.warn(
        `[NXMap] Layer "${configs[mainIndex].layerName}" is the main layer and can't be excluded via visible: false — including it anyway.`
      );
    }

    // Config-time exclusion: layers with visible: false never enter
    // this.layers at all, so they're absent from both the map and
    // getLayerTree()'s filter list. The main layer is exempt (see warning
    // above) — everything else renders relative to it.
    const includedConfigs = configs.filter((c, i) => i === mainIndex || c.visible !== false);

    const explicitMain = includedConfigs.findIndex(c => c.isMainLayer);
    this.mainLayerIndex = explicitMain === -1 ? includedConfigs.indexOf(configs[mainIndex]) : explicitMain;

    this.layers = includedConfigs.map(config => ({
      config,
      shapeData: shapeDataByLayer[config.layerName],
      visible: true,
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
    }));
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

  // theme is the layer's own resolved MapTheme (see resolveTheme()) — an
  // inline value on the point always wins; an omitted field falls back to
  // the theme's marker style, and only then to a last-resort literal (kept
  // here in case a theme registry entry itself omits that field too).
  private toMarker(point: MapPoint, lookupKey: string, theme: MapTheme) {
    return {
      latitude: point.latitude,
      longitude: point.longitude,
      name: point.name,
      shape: point.shape ?? theme.marker?.shape ?? MarkerShape.Balloon,
      color: point.color ?? theme.marker?.color,
      width: point.width ?? theme.marker?.width ?? 20,
      height: point.height ?? theme.marker?.height ?? 20,
      __lookupKey: lookupKey
    };
  }

  // Creating marker points for Syncfusion — one MarkerSettingsModel entry
  // per visible group in this layer, so each group's cluster/style config
  // stays isolated.
  private buildMarkerPoints(layerIndex: number): MarkerSettingsModel[] {
    const layer = this.layers[layerIndex];

    return this.visibleGroups(layer).map(g => {
      // Each group resolves its OWN theme (falling back to the layer's) —
      // not just the layer's theme directly — so a sub-layer API group
      // carrying its own `theme` field picks its own look independent of
      // whatever layer it got merged into. See resolveGroupTheme().
      const theme = this.resolveGroupTheme(g, layer.theme);

      // A group's own points array may include markers individually hidden
      // via the tree UI (point.visible === false) — everything else in
      // MapPoint defaults to visible when the flag is simply absent.
      const points = (g.markerConfig?.points ?? []).filter(p => p.visible !== false);

      const dataSource = points.map((point, index) => {
        const lookupKey = `${layerIndex}:${g.id}:${index}`;
        this.markerLookup.set(lookupKey, {
          type: GraphicType.Marker,
          groupId: g.id,
          groupName: g.name,
          object: point
        });
        return this.toMarker(point, lookupKey, theme);
      });

      return {
        visible: g.visible ?? true,
        animationDuration: 0,
        shape: g.markerConfig?.style?.shape ?? theme.marker?.shape,
        fill: g.markerConfig?.style?.color ?? theme.marker?.color,
        width: g.markerConfig?.style?.width ?? theme.marker?.width,
        height: g.markerConfig?.style?.height ?? theme.marker?.height,
        border: {
          width: theme.marker?.border?.width ?? 1,
          color: theme.marker?.border?.color ?? "#285255"
        },
        tooltipSettings: {
          visible: true,
          valuePath: "name"
        },
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
      } as MarkerSettingsModel;
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
      shape: inline?.shape ?? themeCluster?.shape,
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
  getLayerTree(): LayerTreeNode[] {
    const nodes = this.layers
      .map((layer, layerIndex) => (layer.config.participateInFilter === false ? null : this.buildTreeNode(layer, layerIndex)))
      .filter((node): node is LayerTreeNode => node !== null);

    const nodesByLayerName = new Map(nodes.map(node => [node.layerName, node]));

    nodes.forEach(node => {
      const parentName = this.layers[node.layerIndex].config.parentLayerName;
      const parent = parentName ? nodesByLayerName.get(parentName) : undefined;
      if (parent && parent !== node) {
        parent.children.push(node);
      }
    });

    const nestedLayerNames = new Set(nodes.flatMap(node => node.children.map(child => child.layerName)));
    return nodes.filter(node => !nestedLayerNames.has(node.layerName));
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

    return {
      layerIndex,
      layerName: layer.config.layerName,
      displayName: layer.config.title?.text ?? layer.config.layerName,
      visible: layer.visible,
      isMainLayer: layerIndex === this.mainLayerIndex,
      groups,
      headings: headingOrder.map(heading => ({ heading, groups: headingGroups.get(heading)! })),
      children: [],
      themeName: layer.config.theme
    };
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
    mapOptions.layers = mapOptions.layers.map((existing, layerIndex) => ({
      ...existing,
      visible: true,
      markerSettings: this.buildMarkerPoints(layerIndex),
      navigationLineSettings: this.buildNavigationLines(layerIndex),
      polygonSettings: this.buildPolygon(layerIndex)
    }));
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
      // center apply — not necessarily configs[0] if isMainLayer points
      // elsewhere.
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

  buildLayers() {
    return this.layers.map((layer, layerIndex) => {
      const isMain = layerIndex === this.mainLayerIndex;
      // OSM tiles only render reliably as the MAIN layer. Syncfusion's
      // SubLayer type expects shapeData whose geometry aligns with the
      // base layer's coordinate system — a raster tile source (no
      // shapeData at all) doesn't fit that model, so a SubLayer configured
      // with baseMapType: "osm" would simply not render. Any non-main
      // layer always falls back to shape rendering regardless of what its
      // config says.
      const isOsm = layer.config.baseMapType === "osm" && isMain;
      if (layer.config.baseMapType === "osm" && !isMain) {
        console.warn(
          `[NXMap] Layer "${layer.config.layerName}" requested baseMapType: "osm" but isn't the main layer — falling back to shape rendering. OSM only works as the main/base layer.`
        );
      }

      return {
        // OSM tiles and shapeData are mutually exclusive per Syncfusion —
        // urlTemplate only takes effect when shapeData is NOT set.
        shapeData: isOsm ? undefined : layer.shapeData,
        urlTemplate: isOsm ? "https://a.tile.openstreetmap.org/level/tileX/tileY.png" : undefined,
        shapePropertyPath: "name",
        visible: layer.visible,
        // The main layer renders as Syncfusion's base 'Layer' type; every
        // other config becomes a 'SubLayer' stacked on top of it. If your
        // regions' shapeData geographically overlaps, keep the SubLayer's
        // fill semi-transparent (e.g. "rgba(141,206,255,0.4)") or its
        // opaque shape will visually cover the base layer's markers/
        // polygons even though they still exist underneath in the DOM.
        type: (isMain ? "Layer" : "SubLayer") as any,
        shapeSettings: isOsm
          ? undefined
          : {
              autofill: false,
              // Main layer gets the opaque grey; any SubLayer defaults to a
              // semi-transparent fill instead — SubLayers commonly cover
              // ground the main layer already occupies (a region within
              // the country), and an opaque fill there would visually bury
              // the main layer's own markers/polygons in that area even
              // though they still exist underneath in the DOM. Override
              // per-layer if you need a solid sub-region fill instead.
              fill: isMain ? "#dddddd" : "rgba(66, 133, 244, 0.25)",
              palette: [
                "#E2B247",
                "#88DB46",
                "#42C4E2",
                "#C08AF8",
                "#52BACC",
                "#F4CE2F",
                "#6986ED"
              ],
              border: {
                width: 0.1,
                color: "#A6A6A6"
              }
            },
        // An OSM tile layer has no named shape features to label against.
        dataLabelSettings: isOsm
          ? undefined
          : {
              visible: layer.config.dataLabel?.visible ?? false,
              labelPath: "name",
              textStyle: {
                color: layer.config.dataLabel?.color ?? layer.theme.dataLabel?.color
              },
              opacity: layer.config.dataLabel?.opacity ?? layer.theme.dataLabel?.opacity
            },
        markerSettings: this.buildMarkerPoints(layerIndex),
        navigationLineSettings: this.buildNavigationLines(layerIndex),
        polygonSettings: this.buildPolygon(layerIndex)
      };
    });
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
    return {
      enable: true,
      mouseWheelZoom: true,
      enablePanning: true,
      showToolbar: true,
      // Always taken directly from config, for both "shape" and "osm" —
      // the config is expected to set the right value for whichever
      // baseMapType it's using (a shape layer that wants its own auto-fit
      // behavior instead should simply omit zoomFactor from its config).
      zoomFactor: mainConfig.zoomFactor,
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
}
