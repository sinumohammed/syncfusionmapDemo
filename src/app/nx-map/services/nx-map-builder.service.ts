import { Injectable } from "@angular/core";
import { MarkerSettingsModel } from "@syncfusion/ej2-angular-maps";
import {
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
  MarkerShape,
  ParseTargetResult
} from "../model/nx-map-model";

interface LayerState {
  config: MapConfig;
  shapeData: any;
  groups: MapGroup[];
  // Controls the whole Syncfusion layer's `visible` flag — hides the
  // region's shape/boundary AND everything in it, distinct from a group's
  // own `visible` (which only hides that group's markers/lines/polygons
  // within a still-visible layer).
  visible: boolean;
}

// One node per layer/group/item in the layer control's tree UI. Every
// marker/polygon/circle/line field here is a LIVE reference into this
// layer's state (post-flatten) — toggling `.visible` on any of them and
// calling refresh() is all a consumer needs to do; no id-matching required.
export interface LayerTreeNode {
  layerIndex: number;
  layerName: string;
  visible: boolean;
  // True for whichever config has `isMainLayer: true` (or configs[0] if
  // none does) — the layer panel should disable this node's own checkbox,
  // since hiding it would leave the map with nothing to render against.
  isMainLayer: boolean;
  groups: {
    group: MapGroup;
    markers: MapPoint[];
    polygons: MapPolygon[];
    circles: MapCircle[];
    lines: MapLine[];
  }[];
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
  initialize(configs: MapConfig[], shapeDataByLayer: Record<string, any>) {
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
      groups: (config.groups ?? []).map(group => ({
        ...group,
        markerConfig: group.markerConfig
          ? {
              ...group.markerConfig,
              points: this.flattenPointHierarchy(group.markerConfig.points ?? [])
            }
          : group.markerConfig
      }))
    }));
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

  private toMarker(point: MapPoint, lookupKey: string) {
    return {
      latitude: point.latitude,
      longitude: point.longitude,
      name: point.name,
      shape: point.shape || MarkerShape.Balloon,
      color: point.color,
      width: point.width ?? 20,
      height: point.height ?? 20,
      __lookupKey: lookupKey
    };
  }

  // Creating marker points for Syncfusion — one MarkerSettingsModel entry
  // per visible group in this layer, so each group's cluster/style config
  // stays isolated.
  private buildMarkerPoints(layerIndex: number): MarkerSettingsModel[] {
    const layer = this.layers[layerIndex];

    return this.visibleGroups(layer).map(g => {
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
        return this.toMarker(point, lookupKey);
      });

      return {
        visible: g.visible ?? true,
        animationDuration: 0,
        shape: g.markerConfig?.style?.shape,
        fill: g.markerConfig?.style?.color,
        width: g.markerConfig?.style?.width,
        height: g.markerConfig?.style?.height,
        border: {
          width: 1,
          color: "#285255"
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
        clusterSettings: g.markerConfig?.clusterConfig,
        dataSource
      } as MarkerSettingsModel;
    });
  }

  private buildNavigationLines(layerIndex: number) {
    const layer = this.layers[layerIndex];

    return this.visibleGroups(layer)
      .flatMap(g => (g.lines ?? []).filter(l => l.visible !== false))
      .map(line => ({
        visible: line.visible,
        color: line.color,
        width: line.width,
        dashArray: line.dashArray,
        latitude: line.points.map(x => x.latitude),
        longitude: line.points.map(x => x.longitude)
      }));
  }

  private buildPolygon(layerIndex: number) {
    const layer = this.layers[layerIndex];
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
        polygons.push({
          tooltipText: polygon.name,
          points: polygon.points,
          fill: polygon.background || "red",
          opacity: polygon.opacity || 0.7,
          borderColor: polygon.borderColor || "green",
          borderWidth: polygon.borderWidth || 2
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
        const constructed = this.circleToPolygon(circle);
        if (!constructed) {
          return;
        }
        polygons.push({
          tooltipText: constructed.name,
          points: constructed.points,
          fill: constructed.background || "red",
          opacity: constructed.opacity || 0.7,
          borderColor: constructed.borderColor || "green",
          borderWidth: constructed.borderWidth || 2
        });
        lookup.push({
          type: GraphicType.Circle,
          groupId: g.id,
          groupName: g.name,
          object: circle
        });
      });

    return {
      tooltipSettings: {
        visible: true,
        border: {
          width: 2,
          color: "red"
        }
      },
      polygons
    };
  }

  private circleToPolygon(circle: MapCircle): MapPolygon {
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
      background: circle.background || "red",
      opacity: circle.opacity || 0.7,
      borderColor: circle.borderColor || "green",
      borderWidth: circle.borderWidth || 2,
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

  // Builds the data the layer-control tree UI renders: one node per layer,
  // each with its groups and — inside each group — live references to its
  // markers/polygons/circles/lines. A consumer toggles visibility at any
  // level by mutating `.visible` directly on these same objects (groups/
  // items) or via setLayerVisible() (layers, since `visible` there is a
  // plain boolean field on internal state, not an object reference), then
  // calls refresh().
  getLayerTree(): LayerTreeNode[] {
    return this.layers.map((layer, layerIndex) => ({
      layerIndex,
      layerName: layer.config.layerName,
      visible: layer.visible,
      isMainLayer: layerIndex === this.mainLayerIndex,
      groups: layer.groups.map(group => ({
        group,
        markers: group.markerConfig?.points ?? [],
        polygons: group.polygons ?? [],
        circles: group.circles ?? [],
        lines: group.lines ?? []
      }))
    }));
  }

  refresh(mapOptions: MapOptions) {
    // Reassign (not mutate) layers so Syncfusion's change detection on the
    // e-layer directives actually picks up the new settings, for every
    // layer — not just the first.
    mapOptions.layers = mapOptions.layers.map((existing, layerIndex) => ({
      ...existing,
      visible: this.layers[layerIndex]?.visible ?? true,
      markerSettings: this.buildMarkerPoints(layerIndex),
      navigationLineSettings: this.buildNavigationLines(layerIndex),
      polygonSettings: this.buildPolygon(layerIndex)
    }));
  }

  // configs: one entry per Syncfusion layer. shapeDataByLayer: that layer's
  // GeoJSON, keyed by config.layerName (e.g. from NXMapDataService — fetch
  // one per layerName and forkJoin them before calling this).
  buildMap(configs: MapConfig[], shapeDataByLayer: Record<string, any>): MapOptions {
    this.initialize(configs, shapeDataByLayer);
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
                color: layer.config.dataLabel?.color
              },
              opacity: layer.config.dataLabel?.opacity
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
