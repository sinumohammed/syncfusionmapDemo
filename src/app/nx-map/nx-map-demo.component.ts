import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild
} from "@angular/core";
import { forkJoin, of } from "rxjs";
import { map, switchMap } from "rxjs/operators";
import {
  Maps,
  MapsComponent,
  Marker,
  DataLabel,
  MapsTooltip,
  NavigationLine,
  Polygon,
  Selection,
  Zoom,
  IMarkerClickEventArgs
} from "@syncfusion/ej2-angular-maps";
import {
  LayerFileEnvelope,
  MapConfig,
  MapDonutSelection,
  MapGroup,
  MapOptions,
  MapPoint,
  MetricOverlayRecord,
  PointMetric,
  TooltipTemplateConfig,
  TooltipTemplateItem
} from "./model/nx-map-model";
import { NXMapAppConfig } from "./model/nx-map-app-config";
import {
  DEFAULT_TOOLTIP_TEMPLATE,
  EMPTY_PLACEHOLDER_SHAPE,
  GroupEntry,
  HeadingNode,
  LayerRegionNode,
  LayerTreeNode,
  NXMapBuilderService,
  ShapeFeatureEntry,
  ShapeFeatureGroupNode,
  isLayerRegionNode
} from "./services/nx-map-builder.service";
import { NXMapConfigService } from "./services/nx-map-config.service";
import { buildAppConfig, RawLayerNode } from "./services/parent-config-transform";

// Marker clustering needs no separate module — it's part of Marker, driven
// entirely by each marker group's `clusterSettings` (see the builder
// service). Injecting Marker is enough.
// Selection stays injected even though selectionSettings is no longer set
// anywhere (see buildBaseMapFields()'s own comment) — the `shapeSelected`
// event onShapeSelected() relies on for zoom-to-feature is part of this
// module, confirmed live to still need it (its absence is what caused the
// original "Module Selection is not available" warning and a dead click).
Maps.Inject(Zoom, Marker, DataLabel, MapsTooltip, NavigationLine, Polygon, Selection);

// Named tooltip-tile HTML layouts — selected via TooltipTemplateConfig.layout
// (see its own comment), defaulting to "default" below. Every renderer gets
// the exact same per-item Syncfusion ${field} placeholders to work with —
// v_/u_/c_/v2_/u2_/d2_/v3_/u3_/d3_<metricId>, populated by
// NXMapBuilderService.toMarker() for whatever metric ids
// deriveTooltipTemplate() (below) ends up with — only the HTML/CSS
// wrapping them differs between layouts. Ship a different tile shape for
// another deployment (a different card design, a compact single-line
// tile, whatever) by adding a new entry here and pointing
// tooltipTemplate.layout at its key — nothing about key derivation,
// marker field population, or matching rules needs to change alongside
// it, all of that is layout-agnostic.
const TOOLTIP_TILE_LAYOUTS: Record<string, (item: TooltipTemplateItem) => string> = {
  default: item => {
    const key = item.metricId;
    const title = item.title ?? key.toUpperCase();
    return `
      <div class="mtt-stat">
        <div class="mtt-label">${title}</div>
        <div class="mtt-value" style="color: \${c_${key}};">\${v_${key}} <span class="mtt-unit">\${u_${key}}</span></div>
        <div class="mtt-value2" style="display: \${d2_${key}};">\${v2_${key}} <span class="mtt-unit">\${u2_${key}}</span></div>
        <div class="mtt-value3" style="display: \${d3_${key}};">\${v3_${key}} <span class="mtt-unit">\${u3_${key}}</span></div>
      </div>
    `;
  }
};

@Component({
  selector: "app-nx-map-demo",
  templateUrl: "./nx-map-demo.component.html",
  styleUrls: ["./nx-map-demo.component.scss"]
})
export class NxMapDemoComponent implements OnChanges, AfterViewInit, OnDestroy {
  // The host's own payload — one node per layer (root = base layer, each
  // Configuration[] entry = a static layer), matching parent-config-
  // transform.ts's RawLayerNode shape. Everything else on this component
  // stays dormant until this actually arrives; there's no bundled default
  // config to fall back on, since a real host always supplies this via
  // ngOnChanges (see below), never at construction time.
  @Input() parentConfig?: RawLayerNode;

  // Set by an external donut/category panel (via the host — see
  // app.component.ts) when it selects or deselects a metric card. Flows in
  // as a plain @Input, handled in ngOnChanges below, rather than the host
  // reaching in and calling a method on this component directly through a
  // @ViewChild/@ViewChildren reference — this component doesn't need to
  // know what a "donut" is either way, it just reacts to its own Input
  // changing like it does for parentConfig. See applyDonutSelectionChange()
  // for what a change here actually does.
  @Input() donutSelection?: MapDonutSelection | null;

  // Both assigned outside the constructor (mapInstance by Angular's
  // @ViewChild after view init, mapOptions asynchronously by rebuildMap()
  // once ngOnChanges' forkJoin resolves) — every read of either is already
  // guarded (template uses `?.` throughout, TS-side callers check
  // `if (!this.mapOptions)` / `if (this.mapInstance)` before use), so `!`
  // just tells the compiler what's already true at runtime.
  @ViewChild("mapInstance") mapInstance!: MapsComponent;

  mapOptions!: MapOptions;
  // Gates the *ngIf on <ejs-maps> ALONGSIDE mapOptions — see setMapStyle()'s
  // own comment on why a base-map style swap needs to fully destroy and
  // recreate the Syncfusion component instance rather than just feed it new
  // @Input values.
  mapVisible = true;
  layerPanelOpen = false;
  basemapPanelOpen = false;
  layerTree: (LayerTreeNode | LayerRegionNode)[] = [];

  // Every theme name in the registry, for the layer panel's per-layer theme
  // <select> — static (doesn't depend on mapOptions/layerTree), populated
  // in the constructor body (NOT as a field initializer — those can run
  // before constructor-injected `this.builder` is assigned).
  themeNames: string[] = [];

  // Fallback position before the real toolbar rect is measured (or if it
  // can't be found at all) — overwritten by alignLayerControl() below.
  layerBtnTop = 8;
  layerBtnRight = 90;
  panelTop = 50;
  panelMaxHeight = 500;

  // Mirrors the main layer's current baseMapType, purely for the
  // Shape/Map/Satellite toggle's own active-button styling — the real
  // source of truth is the builder's main layer config. Defaults to "shape"
  // to match MapConfig.baseMapType's own documented default.
  mapStyle: "shape" | "osm" | "satellite" = "shape";

  // Which options the base-map style dropdown offers, and in what order —
  // driven by the main layer's own MapConfig.availableBaseMapTypes (a
  // comma-separated string parsed in loadMap() below). Defaults to all
  // three, in this order, until a config actually resolves.
  baseMapTypeOptions: Array<"shape" | "osm" | "satellite"> = ["shape", "osm", "satellite"];

  // Display labels for the dropdown — "shape" reads as "Simple" and "osm"
  // reads as "Map", to match the conventional Map/Satellite switch naming
  // (see the template's own comment on the basemap-control). Both differ
  // from their underlying baseMapType value, which stays "shape"/"osm" —
  // only the label shown to the user changed.
  readonly baseMapTypeLabels: Record<"shape" | "osm" | "satellite", string> = {
    shape: "Simple",
    osm: "Map",
    satellite: "Satellite"
  };

  // .basemap-control's own right offset — sits just left of .layer-control
  // (the layer LIST button, itself pinned closest to the zoom toolbar),
  // spaced by the layer button's width (36px) plus the same 8px gap
  // alignLayerControl() uses elsewhere.
  get basemapBtnRight(): number {
    return this.layerBtnRight + 36 + 8;
  }

  // Furthest-left of the four controls now — same chained-offset pattern
  // as basemapBtnRight above.
  get maximizeBtnRight(): number {
    return this.basemapBtnRight + 36 + 8;
  }

  // Furthest-left control — the coordinate-picker toggle.
  get coordinatePickerBtnRight(): number {
    return this.maximizeBtnRight + 36 + 8;
  }

  // Dev-tool toggle: while true, clicking empty map area (anywhere
  // resolveClickedGraphic() doesn't already resolve to an existing
  // marker/shape — see onMapClick()) drops a temporary marker labeled
  // with that click's own lat/long, so an existing marker's exact
  // position can be judged/adjusted by clicking right next to it and
  // comparing. Off by default so normal map clicks/panning are
  // unaffected until deliberately turned on.
  coordinatePickerActive = false;

  // Whether the toolbar button shows at all — driven by MainLayerSettings'
  // own coordinatePickerEnabled (see MapConfig's own comment), set in
  // loadMap()'s subscribe. Defaults false (opt-in) until a config
  // resolves.
  coordinatePickerEnabled = false;

  // Real source of truth is document.fullscreenElement (kept in sync by
  // onFullscreenChange() below) — this is just what the button's icon/title
  // renders off. Two-way sync matters because fullscreen can also be
  // exited without the button (Esc key, browser's own "Exit full screen"
  // affordance), which fires the same fullscreenchange event.
  isFullscreen = false;

  toggleFullscreen(): void {
    if (document.fullscreenElement) {
      document.exitFullscreen();
      return;
    }
    // .nx-map itself, not the whole page/host — this is the map plus
    // its own layer/basemap controls, not any donut panel or other widget
    // a parent component might be rendering alongside it.
    this.elRef.nativeElement.querySelector(".nx-map")?.requestFullscreen();
  }

  @HostListener("document:fullscreenchange")
  onFullscreenChange(): void {
    this.isFullscreen = !!document.fullscreenElement;
    // The map's own container size just changed (viewport-filling now, or
    // back to its normal in-page size) — same re-measure the toolbar
    // position needs after any other resize (see onWindowResize()).
    setTimeout(() => this.alignLayerControl(), 150);
  }

  // Filter-tree search box — plain text, matched case-insensitively against
  // layer/heading/group names and leaf labels (see matchesSearch() and the
  // per-level xMatchesSearch() helpers below).
  filterText = "";

  // Brief on-screen confirmation of the last marker/polygon/circle click —
  // see showToast()/onMarkerClick()/onMapClick().
  toastMessage: string | null = null;

  // buildAppConfig(parentConfig) — a description of WHERE each piece of
  // data comes from (inline/file/api), not the map data itself. See
  // ngOnChanges()/loadMap() for how it's resolved into the MapConfig[] the
  // builder service expects. Definite-assignment: only ever set once
  // parentConfig actually arrives (ngOnChanges), never at construction.
  private nxAppConfig!: NXMapAppConfig;
  private configs: MapConfig[] = [];

  // The main/static layers' own explicitly-authored tooltip layout, if
  // any (see loadMap()'s own comment on where this comes from) — undefined
  // when no layer sets one at all. Purely the "pin these titles/this
  // order/this many columns" override; NEVER the only source of which
  // metric ids get a tile at all — see deriveTooltipTemplate().
  private staticTooltipTemplate: TooltipTemplateConfig | undefined;

  // Kept as fields (rather than only local variables inside loadMap()) so
  // applyDonutSelectionChange()/applyMetricSelection() can re-derive from
  // them later without re-fetching the base layer/static layers all over
  // again.
  private baseConfig: MapConfig | undefined;
  private baseShape: any;
  private staticLayerResults: { config: MapConfig; shape: any }[] = [];
  // Snapshot of each static layer's groups exactly as last loaded (index-
  // aligned with staticLayerResults) — kept separately because
  // applyDonutSelectionChange() below needs each group's ORIGINAL points as
  // position/name/value anchors even after a prior selection has replaced
  // staticLayerResults' groups with synthetic ones; deriving from an
  // already-selection-mutated copy on a second click would lose the
  // originals. Set once in loadMap()'s subscribe.
  private staticLayerGroupsOriginal: MapGroup[][] = [];
  // See setMapStyle()'s own comment — the base layer's originally-configured
  // zoomFactor, restored whenever swapping back to a tile (osm/satellite)
  // style after baseConfig.zoomFactor was temporarily overwritten to 1 for
  // "shape".
  private configuredZoomFactor: number | undefined;

  // Set by applyBaseMapStyle() (a style switch OR the toolbar Reset button,
  // both funnel through it) for the duration of its destroy/recreate cycle,
  // cleared once the fresh <ejs-maps> element's own initial render actually
  // finishes (onMapLoaded()). Reported live: clicking Reset on a tile
  // (Map/Satellite) style zoomed all the way out instead of landing on the
  // configured center/zoomFactor — the toolbar Reset button's OWN built-in
  // zoom-to-"initial" behavior fires zoomComplete on the OLD (not yet
  // destroyed) Syncfusion instance before applyBaseMapStyle()'s 50ms-later
  // rebuild replaces it, and onZoomComplete()'s tile-center-preserving fix
  // was capturing/reapplying THAT transitional state — Syncfusion's own
  // "initial" zoom (already documented above as not matching our configured
  // view) — moments before the correct rebuild would have overridden it
  // anyway, but that reapply left a mark. Skipping the override entirely
  // while this is true avoids the interaction; the plain refresh() call
  // still runs regardless, same as always.
  private suppressZoomCenterOverride = false;
  private suppressZoomCenterOverrideTimer: ReturnType<typeof setTimeout> | undefined;

  // Anchor onZoomComplete() re-derives from Syncfusion's own instance
  // whenever a reading looks plausible, and falls back to whenever one
  // doesn't — see its own comment for why this is needed. Seeded by
  // onMapLoaded() to the CONFIGURED center/zoomFactor, since a fresh
  // rebuild is confirmed (live, console-verified) to always land there
  // correctly regardless of base-map style.
  private lastKnownGoodZoom: { center: { latitude: number; longitude: number }; zoomFactor: number } | undefined;

  constructor(
    private builder: NXMapBuilderService,
    private configService: NXMapConfigService,
    private elRef: ElementRef<HTMLElement>
  ) {
    this.themeNames = this.builder.getThemeNames();
  }

  // The host drives this component purely through the parentConfig @Input —
  // there's no construction-time default to fall back on, so everything
  // (buildAppConfig() + the whole resolve/rebuild pipeline) starts here
  // rather than in ngOnInit(), and re-runs in full on every subsequent
  // change too (e.g. the host swapping in a different widget's config),
  // not just the first one.
  ngOnChanges(changes: SimpleChanges): void {
    if (changes["donutSelection"]) {
      this.applyDonutSelectionChange();
    }
    if (!changes["parentConfig"] || !this.parentConfig) {
      return;
    }
    this.nxAppConfig = buildAppConfig(this.parentConfig);
    this.loadMap(this.nxAppConfig);
  }

  private loadMap(appConfig: NXMapAppConfig): void {
    // Resolved SEQUENTIALLY (not inside the forkJoin below) specifically so
    // baseConfig.layerName — the one and only source of truth for the base
    // layer's name — is already known before anything that needs it (the
    // base layer's own name-based shape lookup, and each child layer's
    // default parentLayerName) gets resolved. There's deliberately no
    // separate "base layer name" field on NXMapAppConfig to pass to those in
    // parallel instead — see its own comment for why.
    this.configService
      .resolve(appConfig.baseLayerConfigSource)
      .pipe(
        switchMap(baseConfig =>
          forkJoin({
            baseConfig: of(baseConfig),
            baseShape: this.configService.resolveShapeData(baseConfig.layerName),
            // Every child layer this map brings in, from all three sources
            // (LayerFileLists/LayerAPIURL/LayerInlineJSON), resolved and
            // concatenated into one list — the "union" — then each mapped to
            // the same { config, shape } shape staticLayerResults already
            // used before this layer-file mechanism existed, so
            // rebuildMap()/buildMap()/getLayerTree() need zero changes.
            staticLayers: forkJoin([
              appConfig.layerFileSources.length
                ? forkJoin(appConfig.layerFileSources.map(source => this.configService.resolve<LayerFileEnvelope>(source)))
                : of([] as LayerFileEnvelope[]),
              appConfig.layerApiUrl
                ? this.configService.resolve<LayerFileEnvelope[]>({ source: "api", url: appConfig.layerApiUrl })
                : of([] as LayerFileEnvelope[]),
              of(appConfig.layerInlineJSON ?? [])
            ]).pipe(
              map(([fileLayers, apiLayers, inlineLayers]) =>
                [...fileLayers, ...apiLayers, ...inlineLayers]
                  // A layer file/API entry with no `layerConfig` (e.g. a
                  // shape file that only ever needed `shapeData` for the
                  // MAIN layer's own resolveShapeData() lookup, mistakenly
                  // reused here as a LayerFileLists/LayerAPIURL/
                  // LayerInlineJSON entry) has nothing to build a
                  // LayerTarget from — report it once and drop it rather
                  // than crash the whole map load on `envelope.layerConfig
                  // .parentLayerName` below.
                  .filter(envelope => {
                    if (!envelope.layerConfig) {
                      this.reportLayerProblem(
                        `layer entry has no "layerConfig" (layerName unknown) — skipping it. This field is only optional for the MAIN/base layer's own shape file.`
                      );
                      return false;
                    }
                    return true;
                  })
                  .map(envelope => ({
                    config: {
                      ...envelope.layerConfig,
                      // Defaults to nesting under the base layer in the filter
                      // popup — the envelope's OWN value (set directly inside
                      // its own file/API response/inline block) always wins.
                      parentLayerName: envelope.layerConfig.parentLayerName ?? baseConfig.layerName,
                      participateInFilter: envelope.layerConfig.participateInFilter ?? true,
                      // appConfig.defaultSelectedLayerNames (LayersDefaultSelected),
                      // when set, OVERRIDES the envelope's own `selected` —
                      // it's an explicit "only these start checked" list for
                      // the whole map, not a per-layer default. Unset leaves
                      // the envelope's own `selected` (or true) in charge.
                      selected: appConfig.defaultSelectedLayerNames
                        ? appConfig.defaultSelectedLayerNames.includes(envelope.layerConfig.layerName)
                        : envelope.layerConfig.selected
                    },
                    // Present + non-null shapeData => a real boundary; omitted
                    // => a points/groups layer (MOL-style), synthesized here —
                    // see LayerFileEnvelope's own comment.
                    shape: envelope.shapeData ?? EMPTY_PLACEHOLDER_SHAPE
                  }))
              )
            )
          })
        )
      )
      .subscribe(({ baseConfig, baseShape, staticLayers }) => {
        // "simple" is a config-only alias for "shape" — lets a host write
        // the friendlier name in baseMapType/availableBaseMapTypes without
        // the internal baseMapType type (and every comparison against it,
        // e.g. isTileBaseMapType()) ever needing to know about it. Normalize
        // it here, once, right as the config arrives, so everything
        // downstream (this.mapStyle, the builder, setBaseMapType()) only
        // ever sees "shape".
        if ((baseConfig.baseMapType as string) === "simple") {
          baseConfig.baseMapType = "shape";
        }
        this.baseConfig = baseConfig;
        this.baseShape = baseShape;
        this.coordinatePickerEnabled = baseConfig.coordinatePickerEnabled ?? false;
        this.staticLayerResults = staticLayers;
        this.staticLayerGroupsOriginal = staticLayers.map((s: { config: MapConfig; shape: any }) => s.config.groups ?? []);
        // The config's OWN zoomFactor — tuned for whatever raster tile view
        // it was written for (e.g. 5, to frame Oman in OSM/satellite tiles).
        // setMapStyle() below temporarily overwrites baseConfig.zoomFactor
        // to 1 while "shape" is active (shape's own auto-fit needs
        // Syncfusion's "no extra zoom" baseline to take effect — see
        // NXMapBuilderService.buildBaseMapFields()'s own comment); this is
        // what it restores when swapping back to a tile style.
        this.configuredZoomFactor = baseConfig.zoomFactor;
        // Comma-separated, order-preserving, unknown/duplicate values
        // dropped — falls back to all three (default order) when unset or
        // when nothing in it survives the filter. "simple" is accepted here
        // too (same config-only alias for "shape" as above).
        const parsedOptions = (baseConfig.availableBaseMapTypes ?? "")
          .split(",")
          .map(v => (v.trim().toLowerCase() === "simple" ? "shape" : v.trim().toLowerCase()))
          .filter((v, i, arr): v is "shape" | "osm" | "satellite" => (v === "shape" || v === "osm" || v === "satellite") && arr.indexOf(v) === i);
        this.baseMapTypeOptions = parsedOptions.length ? parsedOptions : ["shape", "osm", "satellite"];
        // tooltipTemplate can be set on the main layer OR any static child
        // layer (MOL is a static layer under "oman", not the main layer
        // itself — see MapConfig.tooltipTemplate's own comment, now
        // updated to reflect this) — first one found wins, main layer
        // checked first. Entirely optional now — see
        // deriveTooltipTemplate()'s own comment for what actually decides
        // the tooltip's tile list when this is unset (or doesn't already
        // cover every metric id the data mentions).
        this.staticTooltipTemplate =
          baseConfig.tooltipTemplate ?? staticLayers.map((s: { config: MapConfig }) => s.config.tooltipTemplate).find((t: any) => !!t);
        // No records yet at initial load — this renders whatever the
        // static config alone provides (or nothing, if it doesn't set one
        // either), same "empty until a donut fetch actually happens" state
        // as before deriveTooltipTemplate() existed.
        this.applyTooltipTemplate([]);
        this.rebuildMap();
      });
  }

  // Reacts to the donutSelection @Input changing (see ngOnChanges above) —
  // fired whenever an external donut/category panel selects or deselects a
  // metric card, via the host binding its own selection state down through
  // NxMapCollectionComponent (see app.component.ts/nx-map-collection.
  // component.ts). This component still has no idea what a "donut" is
  // beyond MapDonutSelection's shape. Every marker stays visible on the map
  // at all times, with its normal hover tooltip, whether or not anything is
  // selected — nothing here ever creates a marker or hides one, except the
  // brand-new unanchored points a fetch can introduce (see
  // applyMetricSelection() below).
  //
  // donutSelection.selectedId is a metric id — no longer any metric a point
  // statically carries (see MapPoint's own history: metrics used to be
  // baked into config JSON; that was app-specific and has been removed).
  // Every reading now comes from nxAppConfig.dataApiUrl, fetched
  // fresh on every click. `slices`/`allIds` are unused here — they only
  // exist on MapDonutSelection for shape-parity with DonutSelectionEvent.
  // A null/unset donutSelection, or one with selectedId: null, clears
  // every group's activeMetricId/activeMetricValues (and any unanchored
  // points from the previous selection) with no fetch at all.
  private applyDonutSelectionChange(): void {
    const selectedId = this.donutSelection?.selectedId ?? null;
    if (!selectedId) {
      this.applyMetricSelection(null, []);
      return;
    }
    const url = this.nxAppConfig.dataApiUrl;
    if (!url) {
      this.reportDataOverlayProblem(`donut "${selectedId}" selected but no DataAPIURL is configured for this map`);
      return;
    }
    this.configService.loadDataOverlay(url, selectedId).subscribe(records => this.applyMetricSelection(selectedId, records));
  }

  // Recursively collects every MapPoint.id in a layer's own ORIGINAL
  // groups (including nested MapPoint.points children — see its own
  // comment on why those exist) — the id universe applyMetricSelection()
  // checks a record's markerId against for THIS layer.
  private collectPointIds(groups: MapGroup[]): Set<string> {
    const ids = new Set<string>();
    const visit = (points: MapPoint[]) => {
      for (const p of points) {
        if (p.id) {
          ids.add(p.id);
        }
        if (p.points?.length) {
          visit(p.points);
        }
      }
    };
    groups.forEach(g => visit(g.markerConfig?.points ?? []));
    return ids;
  }

  // Strips MetricOverlayRecord.tooltip's two reserved non-metric keys
  // ("columns"/"template" — see toTooltipColumns()/toTooltipLayout()
  // below) before it lands on a MapPoint's own tooltipMetrics, which
  // stays strictly Record<string, PointMetric> — toMarker() in
  // nx-map-builder.service.ts never needs to know either exists at all.
  // Returns undefined for an empty/absent tooltip, same as leaving
  // tooltipMetrics unset entirely.
  private static toTooltipMetrics(tooltip: Record<string, PointMetric | number | string> | undefined): Record<string, PointMetric> | undefined {
    if (!tooltip) {
      return undefined;
    }
    const entries = Object.entries(tooltip).filter((entry): entry is [string, PointMetric] => typeof entry[1] === "object");
    return entries.length ? Object.fromEntries(entries) : undefined;
  }

  // One of MetricOverlayRecord.tooltip's reserved keys — pulls out just
  // "columns" (if present, and actually a number) for MapPoint.
  // tooltipColumns, this record's own point's per-point column override.
  // See that field's own comment: undefined here just leaves the point on
  // the map-wide default, same as before this existed.
  private static toTooltipColumns(tooltip: Record<string, PointMetric | number | string> | undefined): number | undefined {
    const columns = tooltip?.["columns"];
    return typeof columns === "number" ? columns : undefined;
  }

  // The other reserved key — pulls out "template" (if present, and
  // actually a string) for MapPoint.tooltipLayout, this record's own
  // point's per-point tile style override. See that field's own comment:
  // undefined here just leaves the point on the map-wide default layout.
  private static toTooltipLayout(tooltip: Record<string, PointMetric | number | string> | undefined): string | undefined {
    const layout = tooltip?.["template"];
    return typeof layout === "string" ? layout : undefined;
  }

  // console.error + a visible toast (existing mechanism, already used for
  // marker/shape click confirmations) — one bad MetricOverlayRecord is
  // loud but never blocks the rest of the array from still plotting.
  private reportDataOverlayProblem(reason: string): void {
    const message = `[NXMap] Metric overlay: ${reason}.`;
    console.error(message);
    this.showToast(message);
  }

  // Same console.error + toast mechanism as reportDataOverlayProblem(),
  // for problems found while building the static layer list itself (as
  // opposed to a metric overlay record) — currently just the missing-
  // layerConfig guard in loadMap().
  private reportLayerProblem(reason: string): void {
    const message = `[NXMap] Layer: ${reason}.`;
    console.error(message);
    this.showToast(message);
  }

  // Fixed id/name for the synthetic group applyMetricSelection() maintains
  // on every layer — holds whichever of this click's records ended up
  // "unanchored" (no resolving markerId, plotted fresh from their own
  // lat/long instead). Always present (even empty) so a layer's own group
  // COUNT never changes click to click, only this one group's contents —
  // same "never destabilize Syncfusion's own bookkeeping" reasoning
  // buildLayers()'s own comment on `visible: true` documents for layers
  // themselves.
  private static readonly METRIC_OVERLAY_GROUP_ID = "__metric_overlay__";

  // Shared by applyDonutSelectionChange()'s clear (selectedId: null, no
  // fetch needed) and the fetched-response path — matches each
  // MetricOverlayRecord to (or plots it as a new point on) a layer, then
  // stamps activeMetricId/activeMetricValues onto every layer's groups,
  // deriving from each layer's own ORIGINAL groups snapshot
  // (staticLayerGroupsOriginal / baseConfig.groups, which rebuildMap()
  // never mutates) so a second selection never builds on top of the
  // previous one's stamped fields or accumulates old unanchored points.
  //
  // Matching rules per record — deliberately NOT a fallback chain anymore:
  // giving a layerId commits a record to an EXACT match on that one layer,
  // it never silently falls through to plotting a new point elsewhere.
  // 1. layerId given but doesn't match any known layer -> error, record
  //    skipped. (unchanged)
  // 2. layerId given AND matches a known layer -> markerId MUST resolve to
  //    an existing point on THAT layer. Resolves -> anchor: the existing
  //    point gets this reading as an overlay. Doesn't resolve (missing, or
  //    just doesn't match anything on that layer) -> error, record
  //    skipped — this used to silently create a new point on that layer
  //    instead; it no longer does, so a mistyped/wrong markerId next to a
  //    real layerId always surfaces as an error rather than quietly
  //    plotting a duplicate.
  // 3. layerId omitted (null/undefined) -> no existing-point search at all
  //    (a bare markerId with no layerId used to be matched against EVERY
  //    layer; it no longer is) — always a brand-new point instead, using
  //    `id` (or markerId, or an auto-generated one) as its own identity,
  //    added to the last static/fixed layer (fallbackTarget below), which
  //    Syncfusion actually gives native marker DOM to under any base-map
  //    style (see fallbackTarget's own comment) — provided latitude/
  //    longitude are present; missing those is still an error (nothing to
  //    plot).
  private applyMetricSelection(selectedId: string | null, records: MetricOverlayRecord[]): void {
    if (!this.baseConfig) {
      return;
    }
    // Rebuilds the tooltip's tile list/DOM template from THIS fetch's own
    // records before anything below stamps tooltipMetrics onto any point —
    // see deriveTooltipTemplate()'s own comment. A clear (selectedId: null,
    // records: []) collapses the tooltip back to whatever the static
    // config alone provides, same as the very first pre-fetch paint.
    this.applyTooltipTemplate(records);
    interface LayerTarget {
      name: string;
      groupsOriginal: MapGroup[];
      pointIds: Set<string>;
      // Keyed by markerId — the FULL matched record, not just its
      // PointMetric fields (MetricOverlayRecord extends PointMetric, so
      // this is still assignable everywhere a PointMetric map is expected —
      // see MapGroup.activeMetricValues below), so applyToGroup() can also
      // reach each match's own `.tooltip` map for the point's always-on
      // hover tooltip, not just its single active-metric value/status.
      anchored: Record<string, MetricOverlayRecord>;
      unanchored: { point: MapPoint; record: MetricOverlayRecord }[];
    }
    const toTarget = (name: string, groupsOriginal: MapGroup[]): LayerTarget => ({
      name,
      groupsOriginal,
      pointIds: this.collectPointIds(groupsOriginal),
      anchored: {},
      unanchored: []
    });
    const targets: LayerTarget[] = [
      toTarget(this.baseConfig.layerName, this.baseConfig.groups ?? []),
      ...this.staticLayerResults.map((s, i) => toTarget(s.config.layerName, this.staticLayerGroupsOriginal[i] ?? []))
    ];
    const mainTarget = targets[0];
    // The LAST target (declared-order) that already has at least one real,
    // config-authored point of its own (t.pointIds.size > 0) — deliberately
    // NOT just targets[targets.length - 1]. NXMapBuilderService.buildLayers()
    // stable-sorts marker-bearing layers to paint in their ORIGINAL declared
    // order (main first, unchanged), so whichever ALREADY-marker-bearing
    // layer is declared last is the one Syncfusion actually gives native
    // marker DOM to under a raster tile ("osm"/"satellite") base map —
    // every earlier marker-bearing layer silently gets none (confirmed
    // live: MOL). Confirmed live the naive "just take the last target"
    // version breaks this: appending ad hoc points to a layer that had NO
    // points of its own (e.g. a trailing marker-less static layer) makes
    // THAT layer newly marker-bearing, which — being declared after MOL —
    // then steals the native-render slot MOL relied on, so MOL's own real
    // markers (maf, Nizwa, ...) silently lose their native SVG too. Picking
    // the last layer that's marker-bearing INDEPENDENT of our own addition
    // guarantees we're riding along on a layer whose paint-order standing
    // our own points can't perturb. Falls back to mainTarget only when NO
    // static layer has any points at all.
    const fallbackTarget = [...targets].reverse().find(t => t.pointIds.size > 0) ?? mainTarget;

    records.forEach((record, i) => {
      if (record.layerId) {
        const namedTarget = targets.find(t => t.name === record.layerId);
        if (!namedTarget) {
          this.reportDataOverlayProblem(`layerId "${record.layerId}" doesn't match any known layer (markerId: ${record.markerId ?? "—"})`);
          return;
        }
        if (!record.markerId || !namedTarget.pointIds.has(record.markerId)) {
          this.reportDataOverlayProblem(
            `markerId "${record.markerId ?? "—"}" doesn't match any existing point on layer "${record.layerId}"`
          );
          return;
        }
        namedTarget.anchored[record.markerId] = record;
        return;
      }
      if (record.latitude !== undefined && record.longitude !== undefined) {
        const id = record.id ?? record.markerId ?? `metric-overlay-${i}`;
        fallbackTarget.unanchored.push({
          // shape/color/width/height forwarded straight from the record —
          // see MetricOverlayRecord's own comment — so one ad hoc point can
          // override the group's theme-derived style (buildOverlayGroup()
          // below) same as any config-authored point already can; omitted
          // when the record doesn't set them, which just inherits the
          // group's theme like every other ad hoc point.
          point: {
            id,
            latitude: record.latitude,
            longitude: record.longitude,
            name: record.name ?? record.markerId,
            shape: record.shape,
            color: record.color,
            width: record.width,
            height: record.height,
            tooltipMetrics: NxMapDemoComponent.toTooltipMetrics(record.tooltip),
            tooltipColumns: NxMapDemoComponent.toTooltipColumns(record.tooltip),
            tooltipLayout: NxMapDemoComponent.toTooltipLayout(record.tooltip)
          },
          record
        });
        return;
      }
      this.reportDataOverlayProblem(`record has no layerId and no latitude/longitude to plot (markerId: ${record.markerId ?? "—"})`);
    });

    // Also rebuilds this group's OWN points (a shallow clone, never
    // mutating g.markerConfig.points — same "always derive from the
    // original snapshot" rule as groupsOriginal itself), stamping each
    // matched point's tooltipMetrics from its own record's `.tooltip` map —
    // independent of `selectedId`/hasMetric below, which only ever govern
    // the SEPARATE on-map overlay label/color for the one active metric.
    // A point with no match this round (or a record with no `.tooltip` of
    // its own) keeps whatever tooltipMetrics it already had — starts
    // undefined, same as before this existed.
    const applyToGroup = (g: MapGroup, anchored: Record<string, MetricOverlayRecord>): MapGroup => {
      const hasMetric = !!selectedId && (g.markerConfig?.points ?? []).some(p => p.id && anchored[p.id] !== undefined);
      const points = g.markerConfig?.points;
      const markerConfig =
        points && points.some(p => p.id && anchored[p.id]?.tooltip)
          ? {
              ...g.markerConfig,
              points: points.map(p =>
                p.id && anchored[p.id]?.tooltip
                  ? {
                      ...p,
                      tooltipMetrics: NxMapDemoComponent.toTooltipMetrics(anchored[p.id].tooltip),
                      tooltipColumns: NxMapDemoComponent.toTooltipColumns(anchored[p.id].tooltip),
                      tooltipLayout: NxMapDemoComponent.toTooltipLayout(anchored[p.id].tooltip)
                    }
                  : p
              )
            }
          : g.markerConfig;
      return { ...g, markerConfig, activeMetricId: hasMetric ? selectedId : null, activeMetricValues: hasMetric ? anchored : null };
    };
    // hostGroupsOriginal is the layer's own real, config-authored groups
    // (e.g. MOL's "mol" group) — its markerConfig.style (shape/color/
    // width/height) is reused verbatim for this ad hoc group's own base
    // marker, rather than falling back to the layer's theme, so an ad hoc
    // point renders visually IDENTICAL to maf/Nizwa/etc. on the same
    // layer (confirmed live: MOL's own points get their small 6x6 circle
    // size from ITS group's style, not from its theme, which defaults to
    // 24x24 — matching only the theme wouldn't have matched the actual
    // marker size). Falls back to no explicit style (theme-derived) only
    // when the host layer has no group with its own style at all — e.g.
    // the main layer, mainTarget's own edge case when there's no static
    // layer to host on at all.
    const buildOverlayGroup = (entries: LayerTarget["unanchored"], hostGroupsOriginal: MapGroup[]): MapGroup => ({
      id: NxMapDemoComponent.METRIC_OVERLAY_GROUP_ID,
      name: "Metric Overlay",
      visible: true,
      markerConfig: {
        style: hostGroupsOriginal.find(g => g.markerConfig?.style)?.markerConfig?.style,
        points: entries.map(e => e.point)
      },
      activeMetricId: entries.length ? selectedId : null,
      activeMetricValues: entries.length ? Object.fromEntries(entries.map(e => [e.point.id as string, e.record])) : null
    });
    const rebuildGroups = (t: LayerTarget): MapGroup[] => [
      ...t.groupsOriginal.map(g => applyToGroup(g, t.anchored)),
      buildOverlayGroup(t.unanchored, t.groupsOriginal)
    ];

    this.baseConfig = { ...this.baseConfig, groups: rebuildGroups(mainTarget) };
    this.staticLayerResults = this.staticLayerResults.map((s, i) => ({ ...s, config: { ...s.config, groups: rebuildGroups(targets[i + 1]) } }));
    this.rebuildMap();
  }

  // Shared by the initial load and applyMetricSelection(): recombines
  // whatever's currently in baseConfig/staticLayerResults into the
  // MapConfig[] + shapeDataByLayer the builder expects, then rebuilds
  // mapOptions and the filter tree from scratch. A full buildMap() (not just
  // builder.refresh()) is needed here because a metric selection changing
  // groups can add/remove whole groups, not just flip visibility on existing
  // ones.
  //
  // render() at the end is NOT optional here: reassigning mapOptions gives
  // Angular a new object reference for [layers], but Syncfusion's own
  // internal marker/shape rendering doesn't reliably redraw from an @Input
  // change alone — removed groups' markers were confirmed to linger on the
  // map (while correctly disappearing from the filter tree) until some
  // unrelated click happened to run an Angular change-detection cycle that
  // Syncfusion's own zoom-refresh path also depends on (see onZoomComplete()
  // above for the same class of issue). Every OTHER mutation path here
  // (toggleGroup/toggleHeading/toggleLayer/toggleLeaf) already calls
  // render() for exactly this reason — rebuildMap() was the one path that
  // didn't. render() itself already guards on `this.mapInstance` being set,
  // so this is a safe no-op on the very first call from ngOnChanges (before
  // ngAfterViewInit has run).
  private rebuildMap(): void {
    if (!this.baseConfig) {
      return;
    }
    // this.baseConfig MUST be first — NXMapBuilderService.initialize()
    // always treats configs[0] as the main/base layer, purely positionally
    // (see MapConfig's own comment); there's no isMainLayer flag to set
    // here anymore. Ad hoc metric-overlay points (see
    // applyMetricSelection()'s own comment on fallbackTarget) ride along on
    // an existing static layer's own groups rather than a dedicated layer
    // of their own — no extra config entry needed here for them at all.
    this.configs = [this.baseConfig, ...this.staticLayerResults.map(s => s.config)];

    const shapeDataByLayer: Record<string, any> = {
      [this.baseConfig.layerName]: this.baseShape
    };
    this.staticLayerResults.forEach(s => {
      shapeDataByLayer[s.config.layerName] = s.shape;
    });

    // Every layer/group comes back fully checked (buildMap()'s default) —
    // a reload is a full reset, not a merge with whatever was previously
    // toggled.
    this.mapOptions = this.builder.buildMap(this.configs, shapeDataByLayer, this.nxAppConfig.theme);
    this.layerTree = this.builder.getLayerTree();
    this.mapStyle = this.builder.getBaseMapType() ?? "shape";
    // Coordinate picking isn't supported in "shape" mode (see
    // dropCoordinatePin()'s own comment) — a full rebuild already
    // regenerates mapOptions.layers[0].markerSettings from scratch,
    // dropping any pin the manual overlay added, but the toggle's own
    // active/highlighted state wouldn't otherwise turn itself back off.
    if (this.mapStyle === "shape") {
      this.coordinatePickerActive = false;
    }
    this.render();
  }

  // Shape/Map/Satellite option click handler (from the base-map dropdown) —
  // swaps the main layer's base map style at runtime, then closes the
  // dropdown the same way picking an option from a native <select> would.
  setMapStyle(style: "shape" | "osm" | "satellite"): void {
    this.basemapPanelOpen = false;
    if (this.mapStyle === style || !this.baseConfig) {
      return;
    }
    this.applyBaseMapStyle(style);
  }

  // Shared by setMapStyle() and resetToConfiguredView() (the toolbar Reset
  // button) — both ultimately need the main layer rebuilt with a correct
  // centerPosition/zoomFactor for `style`, whether that's a genuine style
  // CHANGE or just re-applying the CURRENT one (Reset).
  //
  // Fully destroys and recreates the <ejs-maps> element (via the mapVisible
  // toggle below) rather than just feeding a rebuilt mapOptions into the
  // EXISTING component instance — confirmed live (DOM/network inspection,
  // not just visual) that Angular's own @Input diffing for a changed
  // zoomSettings/centerPosition/layers combination does NOT reliably reset
  // Syncfusion's internal tile zoom bookkeeping (tileZoomLevel etc.):
  // switching to Map/Satellite after Shape kept loading OpenStreetMap tiles
  // at zoom level 1 (Shape's own leftover baseline) instead of the config's
  // zoomFactor: 5, even though mapOptions.zoomSettings.zoomFactor itself was
  // correctly 5, and even calling Syncfusion's own refresh()
  // (destroy+internal-render) on the SAME instance didn't fix it either.
  // Recreating the element from scratch forces exactly the code path a
  // first page load already takes — confirmed correct — with no leftover
  // internal state from whatever style was active before.
  //
  // Trade-off: like any other rebuildMap() call (e.g. applyMetricSelection()),
  // this resets every layer/group/item back to fully checked — any filter
  // toggles the user made before switching style (or hitting Reset) are not
  // preserved.
  private applyBaseMapStyle(style: "shape" | "osm" | "satellite"): void {
    // TEMP DIAGNOSTIC — see wireResetButton()'s own comment. Remove once
    // confirmed either way whether this is running (unexpectedly) during
    // a double-click.
    // eslint-disable-next-line no-console
    console.log("[applyBaseMapStyle] called", style, new Error().stack);
    if (!this.baseConfig) {
      return;
    }
    // Set for the whole destroy/recreate cycle below, cleared a bit after
    // the fresh <ejs-maps> element's own initial render completes
    // (onMapLoaded()) — see its own comment for why onZoomComplete()'s
    // tile-center-preserving fix needs to stay out of the way here.
    // Cancelling any pending clear from a PREVIOUS cycle too, in case the
    // user re-triggers this (another style switch, or Reset again) before
    // that one's own delayed clear fired.
    clearTimeout(this.suppressZoomCenterOverrideTimer);
    this.suppressZoomCenterOverride = true;

    this.baseConfig.baseMapType = style;
    // NXMapBuilderService.buildZoom() always forces zoomFactor 1 for a
    // "shape" main layer regardless of config, so nothing to do for that
    // case here — only restoring the config's own configuredZoomFactor
    // (tuned for raster tiles) for a tile style needs this explicit
    // mutation, since buildZoom() takes a tile layer's zoomFactor directly
    // from config. Applied unconditionally (not just on an actual style
    // CHANGE) so Reset also corrects any drift — e.g. a manual zoom/pan
    // done since the style was last (re)applied.
    if (style !== "shape") {
      this.baseConfig.zoomFactor = this.configuredZoomFactor;
    }

    this.mapVisible = false;
    setTimeout(() => {
      this.rebuildMap();
      this.mapVisible = true;
    });
  }

  toggleBasemapPanel(): void {
    this.basemapPanelOpen = !this.basemapPanelOpen;
  }

  // Whether a group has anything to expand at all — drives groupEntryTpl's
  // choice between a <details> (with its disclosure arrow) and a plain
  // no-arrow row for a group whose markers/polygons/circles/lines are all
  // empty.
  // groupEntryTpl is only ever instantiated for a group groupShown() already
  // let through (see layerNodeTpl), so by the time this runs the group HAS
  // opted into the filter tree — this purely decides expandable-with-leaves
  // vs plain single row, same as before childrenParticipateInFilter existed.
  groupHasLeaves(entry: GroupEntry): boolean {
    return this.groupLeaves(entry).length > 0;
  }

  // Whether a group's own row appears in the filter tree AT ALL — governed
  // by MapGroup.childrenParticipateInFilter (default false/unset). A group
  // that doesn't opt in is already fully covered by its layer's own
  // checkbox (toggleLayer()/setLayerTreeVisibility() cascade to it exactly
  // the same either way — this is a pure display filter), so showing a
  // redundant group-name row underneath just duplicates the layer's own
  // label for no benefit — e.g. MOL's "mol" group ("Main Oil Line") nested
  // under the already-named "MOL" layer. Only a group explicitly opted in
  // gets its own row (and, per groupHasLeaves() above, its own leaves).
  groupShown(entry: GroupEntry): boolean {
    return entry.group.childrenParticipateInFilter === true;
  }

  // Angular template expressions can't contain an inline arrow function
  // (`h.groups.some(e => groupShown(e))` in *ngIf throws NG5002: "Bindings
  // cannot contain assignments" — its parser misreads `=>`), so this is
  // factored out to a plain method call instead.
  headingHasShownGroup(heading: HeadingNode): boolean {
    return heading.groups.some(e => this.groupShown(e));
  }

  // Whether a layer node has anything to expand at all (a shown group,
  // heading with at least one shown group, nested child layer, or shape
  // feature) — drives layerNodeTpl's choice between a <details> and a plain
  // no-arrow row. A layer whose only groups are all opted OUT of the filter
  // tree (childrenParticipateInFilter false/unset) renders as a plain row
  // too, same as one with no groups at all — there'd be nothing to expand
  // into.
  layerHasContent(layer: LayerTreeNode): boolean {
    return (
      layer.groups.some(e => this.groupShown(e)) ||
      layer.headings.some(h => h.groups.some(e => this.groupShown(e))) ||
      layer.children.length > 0 ||
      layer.shapeFeatures.length > 0 ||
      layer.shapeFeatureGroups.length > 0
    );
  }

  // Tri-state checkbox status shared by every parent level in the filter
  // tree (group/heading/layer). "checked" means everything under this node
  // is currently visible, "unchecked" means none of it is, and
  // "indeterminate" means some but not all — the standard checkbox-tree
  // convention, and what makes toggling a single leaf item show up as a
  // partial check on its group, and that group's partial state bubble up
  // through any heading and up to the layer itself.
  private groupLeaves(entry: GroupEntry): { visible?: boolean }[] {
    return [...entry.markers, ...entry.polygons, ...entry.circles, ...entry.lines];
  }

  // Case-insensitive substring match against the current search box text;
  // an empty search matches everything, so the tree renders in full when
  // the box is blank.
  matchesSearch(label: string): boolean {
    const query = this.filterText.trim().toLowerCase();
    return !query || (label || "").toLowerCase().includes(query);
  }

  // A group "matches" if its own name matches, or ANY of its leaves do —
  // whichever leaves matched are what actually render (see the leaf-level
  // *ngIf="matchesSearch(...)" in groupEntryTpl); this just decides whether
  // the group's own row (and its ancestor chain, below) stays in the tree
  // at all while a search is active.
  groupMatchesSearch(entry: GroupEntry): boolean {
    if (!this.filterText.trim()) {
      return true;
    }
    if (this.matchesSearch(entry.group.name)) {
      return true;
    }
    return (
      entry.markers.some(m => this.matchesSearch(m.name || "Marker")) ||
      entry.polygons.some(p => this.matchesSearch(p.name || "Polygon")) ||
      entry.circles.some(c => this.matchesSearch(c.name || "Circle")) ||
      entry.lines.some((_l, i) => this.matchesSearch(`Line ${i + 1}`))
    );
  }

  headingMatchesSearch(heading: HeadingNode): boolean {
    if (!this.filterText.trim()) {
      return true;
    }
    return this.matchesSearch(heading.heading) || heading.groups.some(e => this.groupMatchesSearch(e));
  }

  // Recurses into nested child layers too, so e.g. searching "Musandam"
  // keeps the Oman node (its parent) in the tree even though "Musandam"
  // isn't in Oman's own name.
  layerMatchesSearch(layer: LayerTreeNode): boolean {
    if (!this.filterText.trim()) {
      return true;
    }
    return (
      this.matchesSearch(layer.displayName) ||
      layer.groups.some(e => this.groupMatchesSearch(e)) ||
      layer.headings.some(h => this.headingMatchesSearch(h)) ||
      layer.children.some(c => this.layerOrRegionMatchesSearch(c)) ||
      layer.shapeFeatures.some(f => this.matchesSearch(f.name)) ||
      layer.shapeFeatureGroups.some(g => this.matchesSearch(g.region) || g.features.some(f => this.matchesSearch(f.name)))
    );
  }

  // Type guard exposed to the template (bound methods work in *ngIf,
  // imported free functions don't) — distinguishes a LayerRegionNode from
  // a LayerTreeNode wherever both can appear side by side (layerTree's root
  // list, or a layer's own `children`).
  isRegionNode(item: LayerTreeNode | LayerRegionNode): item is LayerRegionNode {
    return isLayerRegionNode(item);
  }

  // Dispatches search-matching to layerMatchesSearch() or a region's own
  // name/contents, for a list that can hold either kind of node.
  layerOrRegionMatchesSearch(item: LayerTreeNode | LayerRegionNode): boolean {
    if (!this.isRegionNode(item)) {
      return this.layerMatchesSearch(item);
    }
    if (!this.filterText.trim()) {
      return true;
    }
    return this.matchesSearch(item.region) || item.layers.some(l => this.layerOrRegionMatchesSearch(l));
  }

  // Tri-state checkbox for a LayerRegionNode — same combineStates()
  // convention as every other parent level, derived purely from its
  // layers' own state (a region has no visibility of its own). Recurses
  // into any nested LayerRegionNode (a "PDO Assets.North"-style path),
  // same as layerOrRegionMatchesSearch() above.
  layerRegionState(region: LayerRegionNode): "checked" | "unchecked" | "indeterminate" {
    return this.combineStates(region.layers.map(l => (this.isRegionNode(l) ? this.layerRegionState(l) : this.layerState(l))));
  }

  // Cascades show/hide to every layer inside the region, however deeply
  // nested — same "click an indeterminate/unchecked folder -> select
  // all" convention as toggleHeading()/toggleShapeFeatureGroup().
  toggleLayerRegion(region: LayerRegionNode): void {
    const shouldShow = this.layerRegionState(region) !== "checked";
    this.setRegionTreeVisibility(region, shouldShow);
    this.builder.refresh(this.mapOptions);
    this.render();
  }

  // Visits every LEAF layer inside a region, however deeply nested
  // through intermediate folders (a "PDO Assets.North"-style path) —
  // shared by setLayerTreeVisibility()'s own nested-region cascade
  // (tree-state only) and setRegionTreeVisibility() below (which also
  // pushes each leaf's actual builder-level visibility), so the two
  // don't drift apart on how they walk the nesting.
  private forEachRegionLeaf(region: LayerRegionNode, fn: (leaf: LayerTreeNode) => void): void {
    region.layers.forEach(item => (this.isRegionNode(item) ? this.forEachRegionLeaf(item, fn) : fn(item)));
  }

  // Cascade for toggleLayerRegion() specifically: unlike
  // setLayerTreeVisibility()'s own nested-region handling (tree state
  // only — see its comment), a region checkbox click IS the direct
  // toggle target, so it also has to push each affected leaf's actual
  // builder-level visibility, same as toggleLayer() does for a single
  // layer.
  private setRegionTreeVisibility(region: LayerRegionNode, visible: boolean): void {
    this.forEachRegionLeaf(region, layer => {
      if (layer.isMainLayer) {
        return;
      }
      this.setLayerTreeVisibility(layer, visible);
      this.builder.setLayerVisible(layer.layerIndex, visible);
    });
  }

  private combineStates(states: ("checked" | "unchecked" | "indeterminate")[]): "checked" | "unchecked" | "indeterminate" {
    if (!states.length || states.every(s => s === "checked")) {
      return "checked";
    }
    if (states.every(s => s === "unchecked")) {
      return "unchecked";
    }
    return "indeterminate";
  }

  // A group whose own `visible` is false is fully unchecked regardless of
  // its leaves' own flags — none of them render while the group itself is
  // off. Otherwise, checked/unchecked/indeterminate reflects exactly which
  // of its markers/polygons/circles/lines are currently visible.
  groupState(entry: GroupEntry): "checked" | "unchecked" | "indeterminate" {
    if (entry.group.visible === false) {
      return "unchecked";
    }
    const leaves = this.groupLeaves(entry);
    if (!leaves.length) {
      return "checked";
    }
    return this.combineStates(leaves.map(l => (l.visible !== false ? "checked" : "unchecked")));
  }

  headingState(heading: HeadingNode): "checked" | "unchecked" | "indeterminate" {
    return this.combineStates(heading.groups.map(e => this.groupState(e)));
  }

  layerState(layer: LayerTreeNode): "checked" | "unchecked" | "indeterminate" {
    if (!layer.visible) {
      return "unchecked";
    }
    const states = [
      ...layer.groups.map(e => this.groupState(e)),
      ...layer.headings.map(h => this.headingState(h)),
      ...layer.children.map(c => (this.isRegionNode(c) ? this.layerRegionState(c) : this.layerState(c))),
      ...layer.shapeFeatures.map(f => (f.visible ? "checked" : "unchecked") as "checked" | "unchecked"),
      ...layer.shapeFeatureGroups.map(g => this.shapeFeatureGroupState(g))
    ];
    return this.combineStates(states);
  }

  private setGroupVisibility(entry: GroupEntry, visible: boolean): void {
    entry.group.visible = visible;
    this.groupLeaves(entry).forEach(l => {
      l.visible = visible;
    });
  }

  private setLayerTreeVisibility(layer: LayerTreeNode, visible: boolean): void {
    layer.visible = visible;
    layer.groups.forEach(entry => this.setGroupVisibility(entry, visible));
    layer.headings.forEach(heading => heading.groups.forEach(entry => this.setGroupVisibility(entry, visible)));
    layer.children.forEach(child => {
      if (this.isRegionNode(child)) {
        this.forEachRegionLeaf(child, l => this.setLayerTreeVisibility(l, visible));
      } else {
        this.setLayerTreeVisibility(child, visible);
      }
    });
    layer.shapeFeatures.forEach(feature => {
      feature.visible = visible;
      this.builder.setShapeFeatureVisible(layer.layerIndex, feature.index, visible);
    });
    layer.shapeFeatureGroups.forEach(group =>
      group.features.forEach(feature => {
        feature.visible = visible;
        this.builder.setShapeFeatureVisible(layer.layerIndex, feature.index, visible);
      })
    );
  }

  // Turns a layer's own master `visible` flag (the thing that actually
  // controls whether Syncfusion draws its shape/boundary at all — separate
  // from the checkbox's DISPLAYED state, which is purely computed from its
  // descendants) back ON whenever something under it becomes visible again
  // while the shape itself was off — otherwise the newly-checked item stays
  // invisible with no feedback. Deliberately one-directional: unchecking
  // every leaf/group under a layer does NOT hide the shape here — that's
  // the only way to see a region's boundary on its own with no
  // markers/polygons/lines drawn, and forcing the shape off too would make
  // that impossible. Explicitly unchecking the layer's OWN checkbox
  // (toggleLayer()) is the only thing that hides the shape. The main layer
  // is exempt — hiding it would leave nothing for every other layer to
  // render against (same guard as toggleLayer()).
  private syncLayerVisibility(layer: LayerTreeNode): void {
    if (layer.isMainLayer || layer.visible) {
      return;
    }
    const anyVisible = [
      ...layer.groups.map(e => this.groupState(e)),
      ...layer.headings.map(h => this.headingState(h)),
      ...layer.children.map(c => (this.isRegionNode(c) ? this.layerRegionState(c) : this.layerState(c))),
      ...layer.shapeFeatures.map(f => (f.visible ? "checked" : "unchecked") as "checked" | "unchecked"),
      ...layer.shapeFeatureGroups.map(g => this.shapeFeatureGroupState(g))
    ].some(s => s !== "unchecked");

    if (anyVisible) {
      layer.visible = true;
      this.builder.setLayerVisible(layer.layerIndex, true);
    }
  }

  // Checking a group that's currently unchecked/indeterminate shows every
  // leaf under it; checking a fully-checked group hides everything under
  // it instead — same "click an indeterminate checkbox -> select all"
  // convention used at every level here. Either way, syncLayerVisibility()
  // keeps the layer's own master flag matching whatever's left checked.
  toggleGroup(entry: GroupEntry, layer: LayerTreeNode): void {
    const shouldShow = this.groupState(entry) !== "checked";
    this.setGroupVisibility(entry, shouldShow);
    this.syncLayerVisibility(layer);
    this.builder.refresh(this.mapOptions);
    this.render();
  }

  // Shared by every toggleable heading node in the filter popup — cascades
  // to every group (and each of THEIR leaves) nested under it, not just the
  // groups' own `visible` flag, so unchecking a heading really does clear
  // every leaf underneath it rather than leaving stale per-leaf flags that
  // would resurface the next time the heading is checked back on.
  toggleHeading(heading: HeadingNode, layer: LayerTreeNode): void {
    const shouldShow = this.headingState(heading) !== "checked";
    heading.groups.forEach(entry => this.setGroupVisibility(entry, shouldShow));
    this.syncLayerVisibility(layer);
    this.builder.refresh(this.mapOptions);
    this.render();
  }

  // Hides/shows the whole layer (shape + everything in it), cascading the
  // same show/hide down through every group/heading/nested-child-layer
  // under it. The main layer is excluded — every other layer's
  // groups/markers render relative to it, so turning it off would leave the
  // map with nothing at all. The checkbox is already [disabled] for it;
  // this guard covers the case where [disabled] doesn't stop the click
  // event itself from firing.
  toggleLayer(layer: LayerTreeNode): void {
    if (layer.isMainLayer) {
      return;
    }
    const shouldShow = this.layerState(layer) !== "checked";
    this.setLayerTreeVisibility(layer, shouldShow);
    this.builder.setLayerVisible(layer.layerIndex, shouldShow);
    this.builder.refresh(this.mapOptions);
    this.render();
  }

  // Test-only handler for the layer panel's theme <select> — lets you try
  // any theme on a layer live, without touching config JSON. "" (the
  // "Inherit" option) maps to undefined, same as a layer that never set
  // MapConfig.theme at all — it'll fall back through the same
  // group -> layer -> app-wide -> "default" cascade as before.
  onLayerThemeChange(layer: LayerTreeNode, value: string): void {
    const themeName = value || undefined;
    this.builder.setLayerTheme(layer.layerIndex, themeName);
    layer.themeName = themeName;
    this.builder.refresh(this.mapOptions);
    this.render();
  }

  // A single leaf's own visible flag is independent of its group's/layer's,
  // EXCEPT that checking a leaf ON also turns its parent group back on, and
  // syncLayerVisibility() keeps the layer's own master flag matching
  // whatever's left checked either way (on when this was the first thing
  // checked back on, off when this was the last thing left visible).
  // One row per shapeData feature (e.g. Al Wusta's "Lekhwair Cluster"),
  // toggled independently of the rest of the layer — unchecking one filters
  // just that feature out of what's sent to Syncfusion (see
  // NXMapBuilderService.visibleShapeData()), same "gone, not just dimmed"
  // behavior as unchecking a group leaf.
  toggleShapeFeature(feature: ShapeFeatureEntry, layer: LayerTreeNode): void {
    feature.visible = !feature.visible;
    this.builder.setShapeFeatureVisible(layer.layerIndex, feature.index, feature.visible);
    this.syncLayerVisibility(layer);
    this.builder.refresh(this.mapOptions);
    this.render();
  }

  // Tri-state checkbox for a ShapeFeatureGroupNode (e.g. "Al Wusta North"
  // bucketing "Lekhwair Cluster") — same convention as groupState()/
  // headingState() above.
  shapeFeatureGroupState(group: ShapeFeatureGroupNode): "checked" | "unchecked" | "indeterminate" {
    return this.combineStates(group.features.map(f => (f.visible ? "checked" : "unchecked")));
  }

  // Checking an indeterminate/unchecked region shows every feature under
  // it; checking a fully-checked one hides them all — same convention as
  // toggleGroup()/toggleHeading() above.
  toggleShapeFeatureGroup(group: ShapeFeatureGroupNode, layer: LayerTreeNode): void {
    const shouldShow = this.shapeFeatureGroupState(group) !== "checked";
    group.features.forEach(feature => {
      feature.visible = shouldShow;
      this.builder.setShapeFeatureVisible(layer.layerIndex, feature.index, shouldShow);
    });
    this.syncLayerVisibility(layer);
    this.builder.refresh(this.mapOptions);
    this.render();
  }

  toggleLeaf(item: { visible?: boolean }, group: MapGroup, layer: LayerTreeNode): void {
    const shouldShow = !(item.visible !== false);
    item.visible = shouldShow;
    if (shouldShow) {
      group.visible = true;
    }
    this.syncLayerVisibility(layer);
    this.builder.refresh(this.mapOptions);
    this.render();
  }

  onMarkerClick(args: IMarkerClickEventArgs): void {
    const graphic = this.builder.resolveMarkerClick(args as any);
    if (!graphic) {
      return;
    }
    console.log(`You selected ${graphic.groupName}`, graphic);
    this.showToast(`You clicked "${graphic.object.name || "Item"}" in "${graphic.groupName}"`);
  }

  onMapClick(args: any): void {
    const graphic = this.builder.resolveClickedGraphic(args.target);
    if (!graphic) {
      if (this.coordinatePickerActive) {
        this.dropCoordinatePin(args);
      }
      return;
    }
    console.log(`You selected ${graphic.groupName}`, graphic);
    this.showToast(`You clicked "${graphic.object.name || "Item"}" in "${graphic.groupName}"`);
  }

  toggleCoordinatePicker(): void {
    // "shape" mode never resolves a coordinate (see dropCoordinatePin()'s
    // own comment) — the template already disables the button then, but
    // this guards the same rule against a click landing anyway (e.g. a
    // disabled attribute not fully suppressing every input path).
    if (this.mapStyle === "shape") {
      return;
    }
    this.coordinatePickerActive = !this.coordinatePickerActive;
    if (!this.coordinatePickerActive) {
      this.clearCoordinatePin();
    }
  }

  // UNVERIFIED live: getTileGeoLocation() is Syncfusion's own pixel->geo
  // conversion, already confirmed working for a TILE (osm/satellite) main
  // layer elsewhere in this file (onZoomComplete()'s own correction) —
  // whether it also returns a meaningful location for a "shape" main
  // layer hasn't been confirmed against a real render. args.clientX/
  // clientY are read defensively (a couple of likely field names) since
  // Syncfusion's own (click) args shape for <ejs-maps> isn't documented
  // here beyond the .target field resolveClickedGraphic() already uses.
  private dropCoordinatePin(args: any): void {
    if (!this.mapInstance) {
      return;
    }
    const inst = this.mapInstance as any;
    const hostRect = (this.elRef.nativeElement.querySelector(".map-container") as HTMLElement | null)?.getBoundingClientRect();
    const clientX = args.clientX ?? args.pageX ?? args.originalEvent?.clientX;
    const clientY = args.clientY ?? args.pageY ?? args.originalEvent?.clientY;
    if (!hostRect || typeof clientX !== "number" || typeof clientY !== "number") {
      this.showToast("Couldn't read click position for coordinate picking.");
      return;
    }
    if (typeof inst.getTileGeoLocation !== "function") {
      this.showToast("Coordinate picking isn't available on this map instance.");
      return;
    }
    const geo = inst.getTileGeoLocation(clientX - hostRect.left, clientY - hostRect.top);
    if (!geo || geo.latitude == null || geo.longitude == null) {
      this.showToast("Couldn't resolve a coordinate for that click — try Map/Satellite mode.");
      return;
    }
    this.setCoordinatePin(geo.latitude, geo.longitude);
    const label = `Lat ${geo.latitude.toFixed(5)}, Lng ${geo.longitude.toFixed(5)}`;
    // Clipboard API needs a secure context (https, or localhost) and can
    // reject (permissions, insecure origin) — the toast still lands
    // either way, just without "— copied" appended, rather than the
    // whole pick silently failing over a clipboard permission issue.
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(`${geo.latitude}, ${geo.longitude}`)
        .then(() => this.showToast(`${label} — copied to clipboard`))
        .catch(() => this.showToast(label));
    } else {
      this.showToast(label);
    }
  }

  // Adds (replacing any previous one) a single temporary marker directly
  // onto mapOptions.layers[0]'s own markerSettings array — deliberately
  // bypassing NXMapBuilderService entirely, since this is a throwaway
  // dev-tool overlay, not real map data: it never needs to survive a
  // config reload, and doesn't touch anything builder.refresh() would
  // need to know about. mapInstance.refresh() alone (Syncfusion's own
  // native repaint, not the builder's) is what actually picks up this
  // manual mapOptions.layers mutation, same as every other Angular-bound
  // @Input change to <ejs-maps>. A LATER real builder.refresh() call
  // (any layer toggle, donut click, etc.) rebuilds markerSettings from
  // the builder's own canonical state and silently drops this pin along
  // with it — acceptable for a temporary marker, but worth knowing if it
  // unexpectedly disappears after some other interaction.
  private readonly coordinatePinFlag = "__coordinatePin";

  private setCoordinatePin(latitude: number, longitude: number): void {
    if (!this.mapOptions?.layers?.length) {
      return;
    }
    const pinEntry = {
      [this.coordinatePinFlag]: true,
      visible: true,
      animationDuration: 0,
      dataSource: [{ latitude, longitude, name: `Lat ${latitude.toFixed(5)}, Lng ${longitude.toFixed(5)}` }],
      shape: "Pentagon",
      fill: "#ff3d00",
      height: 16,
      width: 16,
      latitudeValuePath: "latitude",
      longitudeValuePath: "longitude",
      tooltipSettings: { visible: true, valuePath: "name" }
    };
    this.mapOptions.layers = this.mapOptions.layers.map((layer: any, i: number) =>
      i === 0
        ? { ...layer, markerSettings: [...(layer.markerSettings ?? []).filter((m: any) => !m[this.coordinatePinFlag]), pinEntry] }
        : layer
    );
    this.mapInstance.refresh();
  }

  private clearCoordinatePin(): void {
    if (!this.mapOptions?.layers?.length) {
      return;
    }
    this.mapOptions.layers = this.mapOptions.layers.map((layer: any) => ({
      ...layer,
      markerSettings: (layer.markerSettings ?? []).filter((m: any) => !m[this.coordinatePinFlag])
    }));
    if (this.mapInstance) {
      this.mapInstance.refresh();
    }
  }

  // Fires on a click landing on ANY layer's raw shapeData feature (not
  // gated by any per-layer setting — Syncfusion dispatches this for every
  // shape click regardless), so scoping to just the intended features
  // (e.g. Al Wusta's "Lekhwair"/"Qarn Alam" clusters) happens entirely in
  // resolveSelectedShapeName()'s own matching — a click on, say, Oman's or
  // MOL's shape just won't match anything there and this is a no-op.
  // Toast only, deliberately no zoom or shape restyling — see
  // resolveSelectedShapeName()'s own comment for why both were dropped
  // (Syncfusion's native selectionSettings border proved unreliable, and a
  // click-driven zoomByPosition() conflicted with interactive wheel-zoom).
  onShapeSelected(args: any): void {
    const featureName = this.builder.resolveSelectedShapeName(args?.shapeData);
    if (featureName) {
      this.showToast(`"${featureName}"`);
    }
  }

  // On-screen equivalent of the console.log above — shows briefly near the
  // top of the map, then clears itself. Re-triggering (another click before
  // the timer fires) restarts the timer rather than stacking multiple
  // pending clears, so the message always stays up for a full 2.5s from the
  // MOST RECENT click.
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  showToast(message: string): void {
    clearTimeout(this.toastTimer);
    this.toastMessage = message;
    this.toastTimer = setTimeout(() => {
      this.toastMessage = null;
    }, 2500);
  }

  // Two rapid successive toggles (e.g. unchecking two layers back to back,
  // faster than this 200ms delay) used to each schedule their own
  // independent setTimeout -> mapInstance.refresh() call here — two
  // overlapping Syncfusion refreshes firing close together were confirmed
  // live to corrupt which rendered DOM group ends up matching which
  // "_LayerIndex_<n>" mid-rebuild, so syncLayerDomVisibility() (keyed off
  // that same id) could end up hiding the WRONG layer — one that was never
  // toggled at all. Same class of issue onZoomComplete() below already
  // guards against for continuous scroll-zooming; clearing any pending
  // timer before scheduling a new one here means only the LATEST toggle's
  // refresh ever actually fires, once things have settled, instead of two
  // stacking up.
  private renderTimer: ReturnType<typeof setTimeout> | undefined;

  private render(): void {
    if (this.mapInstance) {
      clearTimeout(this.renderTimer);
      this.renderTimer = setTimeout(() => {
        this.mapInstance.refresh();
        // Lines are redrawn (new <path> elements) on every refresh — the
        // draw-in animation needs re-applying each time, not just on the
        // very first load.
        this.syncLayerDomVisibility();
        setTimeout(() => this.animateNavigationLines(), 100);
      }, 200);
    }
  }

  // Confirmed against a live render: toggling a Syncfusion layer's own
  // `visible` flag to false updates the data model correctly (checkbox,
  // mapOptions.layers[i].visible) but Syncfusion does NOT actually hide
  // that layer's rendered shape/boundary — not from the [layers] binding
  // alone, and not even after an explicit mapInstance.refresh() call. Only
  // its markers/polygons correctly disappear when a refresh regenerates
  // their DATA (dataSource arrays shrinking to empty) — the shape itself
  // just keeps rendering regardless of `visible`. Since refresh() fully
  // recreates each layer's DOM group, this has to run AFTER refresh(), not
  // before, or the display:none we set gets thrown away with the old
  // elements. Same class of DOM-level workaround as wireResetButton()/
  // animateNavigationLines() above for other Syncfusion gaps.
  private syncLayerDomVisibility(): void {
    if (!this.mapOptions?.layers) {
      return;
    }
    const host = this.elRef.nativeElement;
    // buildLayers() (nx-map-builder.service.ts) can paint layers in a
    // different order than they were declared (see its own comment) — DOM
    // position "_LayerIndex_<i>" always follows PAINT order, but
    // getLayerVisible() is keyed by the ORIGINAL layerIndex. renderOrder[i]
    // translates position i back to that original index — without it, this
    // was toggling visibility on whichever layer happened to render at
    // position i, not the one actually checked/unchecked in the panel.
    const renderOrder = this.builder.getRenderOrder();
    this.mapOptions.layers.forEach((_layerSettings, i) => {
      const group = host.querySelector(`[id$="_LayerIndex_${i}"]`) as HTMLElement | null;
      if (group) {
        // builder.refresh() always feeds Syncfusion's OWN layers[i].visible
        // as true (see its comment) — reading it here would show every
        // layer as visible regardless of what the user actually toggled.
        // getLayerVisible() is the real per-layer flag that was never
        // handed to Syncfusion, specifically so its layersCollection never
        // drops/renumbers an entry and desyncs this index-based lookup.
        const originalIndex = renderOrder[i] ?? i;
        group.style.display = this.builder.getLayerVisible(originalIndex) ? "" : "none";
      }
    });
  }

  ngAfterViewInit(): void {
    // Only a fallback for a genuinely async config load (a real HTTP
    // source) — loadMap() is kicked off in ngOnChanges, which fires BEFORE
    // ngAfterViewInit, so for an inline/synchronous config (e.g. the
    // bundled real-parent-config.json import) loadMap()'s own subscribe
    // has already injected the CORRECT config-driven template by the time
    // this runs; calling injectMarkerTooltipTemplate() unconditionally
    // here would silently stomp that back to the default every time,
    // which is exactly what was happening before this guard existed.
    if (!document.getElementById("marker-tooltip-template")) {
      this.injectMarkerTooltipTemplate(DEFAULT_TOOLTIP_TEMPLATE);
    }
    this.injectMarkerLabelTemplate();
    this.wireResetButton();
    this.observeLayerGroupCreation();
    // Syncfusion renders the zoom toolbar asynchronously after the
    // component initializes — give it a moment before measuring.
    setTimeout(() => {
      this.alignLayerControl();
    }, 300);
  }

  ngOnDestroy(): void {
    this.layerGroupObserver?.disconnect();
  }

  private layerGroupObserver: MutationObserver | undefined;

  // Syncfusion recreates each layer group's own DOM element asynchronously
  // in reaction to builder.refresh()'s mutated mapOptions.layers array —
  // NOT synchronously within the click handler that triggered it. Confirmed
  // live (MutationObserver timestamps) to land anywhere from ~10ms to
  // ~40ms later, well before the 200ms-debounced "real" Syncfusion
  // mapInstance.refresh() in render() below ever runs. Every freshly
  // recreated element starts visible (see NXMapBuilderService.refresh()'s
  // own comment on why Syncfusion's OWN `visible` flag is always fed as
  // true) — without reacting to this, EVERY currently-hidden layer visibly
  // flashes back on for that whole gap, on every single toggle, not just
  // the one actually clicked (a fixed-delay setTimeout() correction here
  // was tried and confirmed live to be unreliable — the recreation's own
  // timing varies enough that a guessed delay either fires too early, and
  // gets overwritten by the recreation right after, or leaves a visible
  // gap). Reacting to the recreation itself removes the guesswork.
  //
  // Observes `.nx-map` (stable across a base-map style switch's own
  // destroy/recreate of <ejs-maps> — see applyBaseMapStyle()) rather than
  // <ejs-maps> itself, so this one observer, set up once, keeps working
  // across that cycle too. childList only (not attributes) — this only
  // ever needs to react to a layer group ELEMENT appearing, not to
  // syncLayerDomVisibility()'s own `.style.display =` writes, which would
  // otherwise risk a feedback loop.
  private observeLayerGroupCreation(): void {
    const host = this.elRef.nativeElement.querySelector(".nx-map");
    if (!host) {
      return;
    }
    this.layerGroupObserver = new MutationObserver(mutations => {
      const touchesLayerGroup = mutations.some(m =>
        Array.from(m.addedNodes).some(
          n => n instanceof HTMLElement && (n.id.includes("_LayerIndex_") || !!n.querySelector?.('[id*="_LayerIndex_"]'))
        )
      );
      if (touchesLayerGroup) {
        this.syncLayerDomVisibility();
      }
    });
    this.layerGroupObserver.observe(host, { childList: true, subtree: true });
  }

  // Builds this click's effective tooltip layout — the ONLY place any
  // metric id's tile gets decided app-wide, no hardcoded metric-id list
  // involved anywhere in this pipeline. Starts from
  // this.staticTooltipTemplate's own items (if any — a layer's explicit
  // MapConfig.tooltipTemplate pins that metric id's title/position), then
  // adds one auto-generated item for every OTHER key any of `records`' own
  // MetricOverlayRecord.tooltip maps mention (title from that metric's own
  // PointMetric.label, falling back to the key itself uppercased) — so a
  // metric id NO config anywhere has ever declared still gets a working
  // tile the very first time the fetched data mentions it, exactly what
  // "tomorrow it might be a different name/different count" needs.
  //
  // `columns` here is the MAP-WIDE default only — a static layer's own
  // MapConfig.tooltipTemplate.columns when set, otherwise
  // DEFAULT_TOOLTIP_TEMPLATE.columns. It does NOT come from any record's
  // own `tooltip.columns` — that reserved key is a PER-POINT override
  // instead (see MapPoint.tooltipColumns' own comment): applyMetricSelection()
  // forwards it onto just the one point that record matches/creates, never
  // broadcast to every point the way a title/item is.
  private deriveTooltipTemplate(records: MetricOverlayRecord[]): TooltipTemplateConfig {
    const items = new Map<string, TooltipTemplateItem>();
    (this.staticTooltipTemplate?.items ?? []).forEach(item => items.set(item.metricId, item));
    records.forEach(record => {
      Object.entries(record.tooltip ?? {}).forEach(([key, metric]) => {
        if (key === "columns" || key === "template") {
          return;
        }
        if (!items.has(key)) {
          items.set(key, { metricId: key, title: (metric as PointMetric).label ?? key.toUpperCase() });
        }
      });
    });
    return {
      columns: this.staticTooltipTemplate?.columns ?? DEFAULT_TOOLTIP_TEMPLATE.columns,
      layout: this.staticTooltipTemplate?.layout,
      items: Array.from(items.values())
    };
  }

  // Shared by loadMap() (initial paint, records: []) and
  // applyMetricSelection() (every donut fetch) — derives this click's
  // tooltip layout, re-injects the DOM template, and keeps
  // NXMapBuilderService.tooltipMetricKeys/defaultTooltipColumns/
  // defaultTooltipLayout in the exact same lockstep deriveTooltipTemplate()'s
  // own comment describes, all in one call.
  private applyTooltipTemplate(records: MetricOverlayRecord[]): void {
    const tooltipTemplate = this.deriveTooltipTemplate(records);
    this.injectMarkerTooltipTemplate(tooltipTemplate);
    this.builder.setTooltipMetricKeys(tooltipTemplate.items.map(item => item.metricId));
    this.builder.setDefaultTooltipColumns(tooltipTemplate.columns);
    this.builder.setDefaultTooltipLayout(tooltipTemplate.layout ?? "default");
  }

  // Builds the #marker-tooltip-template element that
  // nx-map-builder.service.ts's markerSettings.tooltipSettings.template
  // looks up by id, via plain DOM APIs rather than declaring it inline in
  // this component's own Angular template — Angular's template compiler
  // parses EVERY element in that template string, even one never meant to
  // be rendered by Angular itself, and chokes on the bare ${...}
  // placeholders Syncfusion's OWN templating engine needs there (NG5002
  // "Invalid ICU message" — Angular reads a lone `{`/`}` as ICU/
  // interpolation syntax, confirmed live). Building it here as a plain
  // string sidesteps Angular's parser entirely; Syncfusion only ever reads
  // this element's innerHTML as text on hover, so how it got into the DOM
  // doesn't matter to it. Appended to document.body (not this component's
  // own element) since Syncfusion's template lookup is a plain
  // document.querySelector(selector) — global scope either way, and this
  // element is never meant to be visible or positioned relative to
  // anything.
  //
  // ${name} is the marker's own name (bound from toMarker()'s dataSource
  // object). toMarker() in nx-map-builder.service.ts precomputes
  // v_/u_/c_/v2_/u2_/d2_/v3_/u3_/d3_<key> fields for each of
  // NXMapBuilderService's own tooltipMetricKeys, since Syncfusion's
  // ${field} template substitution has no loop construct of its own.
  // `config` (deriveTooltipTemplate()'s own output, or
  // NXMapBuilderService.DEFAULT_TOOLTIP_TEMPLATE for the very first
  // pre-load fallback) decides which metrics appear, in what order, under
  // what title, how many tiles per row, and which TOOLTIP_TILE_LAYOUTS
  // entry renders each one — rebuilding this element's innerHTML is
  // enough to change the tooltip's whole layout, no other code path
  // involved. Called again every time loadMap() resolves a fresh
  // baseConfig (rebuildMap(), style switches, Reset...) AND on every donut
  // fetch (applyTooltipTemplate() above) — cheap (a handful of string
  // concatenation) and keeps the template in sync with whatever metric
  // ids are actually live right now.
  private injectMarkerTooltipTemplate(config: TooltipTemplateConfig): void {
    let container = document.getElementById("marker-tooltip-template");
    if (!container) {
      container = document.createElement("div");
      container.id = "marker-tooltip-template";
      container.style.display = "none";
      document.body.appendChild(container);
    }

    // Which HTML shape each tile renders as — see TOOLTIP_TILE_LAYOUTS' own
    // comment for how a different deployment plugs in an alternate one.
    const renderTile = TOOLTIP_TILE_LAYOUTS[config.layout ?? "default"] ?? TOOLTIP_TILE_LAYOUTS["default"];
    const tiles = config.items.map(renderTile).join("");
    // No donut metric selected (or a static-only point with nothing to
    // show) -> zero tiles for EVERY marker, since `tiles` is built once
    // here from the map-wide derived template, not per-marker. Omitting
    // .mtt-grid entirely (rather than rendering it empty) drops both its
    // margin-top gap and the outer card's min-width, below, so a
    // name-only tooltip sizes to the name instead of the metrics-card
    // dimensions.
    const grid = tiles
      ? `<div class="mtt-grid" style="grid-template-columns: repeat(\${columns}, 1fr);">${tiles}</div>`
      : "";

    // A single CSS grid, not pre-split into fixed `columns`-many-wide rows
    // at build time — `grid-template-columns` itself comes from
    // `${columns}`, a per-MARKER Syncfusion field (NXMapBuilderService.
    // toMarker(): point.tooltipColumns ?? the map-wide default), not a
    // fixed value baked into this shared template. That's what makes
    // MapPoint.tooltipColumns a genuinely PER-POINT override — every
    // marker substitutes its OWN column count into the exact same
    // template HTML, wrapping tiles into that many columns automatically
    // (the browser's grid layout, not row-slicing here).
    //
    // `${layoutClass}` on the outer element is the same per-marker trick
    // for MapPoint.tooltipLayout — a CSS class name (e.g.
    // "mtt-layout-compact") scoping alternate tile styling rules (see
    // nx-map-demo.component.scss) onto just THIS marker's tooltip
    // instance, still built from this exact same shared markup.
    container.innerHTML = `
      <div class="marker-tooltip \${layoutClass}${tiles ? "" : " mtt-name-only"}">
        <div class="mtt-header">
          <span class="mtt-title">\${name}</span>
        </div>
        ${grid}
      </div>
    `;
  }

  // Builds the #marker-label-template element that
  // nx-map-builder.service.ts's buildMarkerPoints() looks up (via
  // markerSettings.template) for the overlay layer it adds when a group's
  // activeMetricId is set — an always-visible icon + metric value/color
  // label per point, as opposed to #marker-tooltip-template above
  // (hover-only, always visible with the base layer). Same
  // plain-DOM-string-building approach and same reasoning for it (Angular's
  // template compiler chokes on bare ${...} placeholders — see
  // injectMarkerTooltipTemplate()'s own comment).
  //
  // ${color}, ${label}, and ${iconShape} come straight from
  // toMetricOverlayMarker()'s own dataSource object in
  // nx-map-builder.service.ts — `label` is already "name<br>value" for the
  // active metric, `color` is that reading's resolved color (impact-specific
  // for a "high" customer/non-customer reading, a shared neutral color
  // otherwise), and `iconShape` is "diamond"/"triangle"/"circle" selecting
  // which .marker-label-icon--* CSS rule draws the icon — set once here as
  // a CSS custom property (\`--icon-color\`) rather than a shape-specific
  // inline style property, since different shapes need different CSS
  // properties to carry the same color (border-bottom-color for a triangle,
  // background for a diamond/circle).
  private injectMarkerLabelTemplate(): void {
    if (document.getElementById("marker-label-template")) {
      return;
    }
    const container = document.createElement("div");
    container.id = "marker-label-template";
    container.style.display = "none";
    container.innerHTML = `
      <div class="marker-label">
        <span class="marker-label-icon marker-label-icon--\${iconShape}" style="--icon-color: \${color};"></span>
        <span class="marker-label-text" style="color: \${color};">\${label}</span>
      </div>
    `;
    document.body.appendChild(container);
  }

  // Syncfusion's own `resize` event fires once ITS internal resize handling
  // (redrawing the SVG) has started, but NOT necessarily once the zoom
  // toolbar has finished being repositioned within that redraw — a flat
  // 50ms delay here used to just guess it was done by then. Reported live:
  // during an actual window drag-resize, the layer button consistently
  // ended up pinned to the far left (a stale/mid-move toolbarRect fed into
  // alignLayerControl()'s right-edge math) and only self-corrected on the
  // NEXT thing that happened to call alignLayerControl() again — e.g.
  // toggleLayerPanel()'s own re-measure on open — never on the resize
  // itself. Root cause: nothing guaranteed Syncfusion's toolbar element had
  // actually stopped moving by the time we measured it.
  //
  // Confirmed live (dispatching a synthetic resize against a resized
  // container) that the toolbar can still be mid-move well past a short
  // poll window — an earlier version of this fix that gave up after ~8
  // quick attempts (~320ms) locked in a stale position exactly like the
  // original bug, just less often. Fixed with a longer, more forgiving
  // poll (up to ~1.2s across 15 attempts, each a real animation frame
  // apart) PLUS a guaranteed trailing re-measure ~700ms after the last
  // resize event regardless of what the poll concluded — belt-and-suspenders,
  // since no fixed poll count can be proven sufficient against a redraw
  // whose exact timing isn't documented.
  private resizeAlignAttempt = 0;
  private resizeFinalCheckTimer: ReturnType<typeof setTimeout> | undefined;

  onMapResize(): void {
    this.resizeAlignAttempt = 0;
    this.scheduleAlignLayerControl();

    clearTimeout(this.resizeFinalCheckTimer);
    this.resizeFinalCheckTimer = setTimeout(() => {
      this.alignLayerControl();
    }, 700);
  }

  private scheduleAlignLayerControl(): void {
    setTimeout(() => {
      const before = this.measureToolbarLeft();
      requestAnimationFrame(() => {
        const after = this.measureToolbarLeft();
        this.resizeAlignAttempt++;
        const stillMoving = before !== null && after !== null && before !== after;
        if (stillMoving && this.resizeAlignAttempt < 15) {
          this.scheduleAlignLayerControl();
          return;
        }
        this.alignLayerControl();
      });
    }, 60);
  }

  // Shared by scheduleAlignLayerControl()'s own stability check and
  // alignLayerControl() could use this too, but stays independent — this
  // one intentionally does the bare minimum (no container lookup, no
  // layerBtnRight math) so polling it repeatedly during a resize stays
  // cheap.
  private measureToolbarLeft(): number | null {
    const toolbar = this.elRef.nativeElement.querySelector('[id*="Zooming_ToolBar"]') as Element | null;
    return toolbar ? toolbar.getBoundingClientRect().left : null;
  }

  // Fires once Syncfusion's initial render (shapes, markers, navigation
  // lines) has actually completed — the reliable point to run the one-time
  // "draw" animation on navigation lines. Reset button wiring is delegated
  // from the host element once in ngAfterViewInit() (see wireResetButton()'s
  // own comment) and survives every rebuild, so it doesn't need re-running
  // here.
  onMapLoaded(): void {
    // Applies the real per-layer visible flags (MapConfig.selected: false,
    // or a runtime toggle mid-rebuild) via the same display:none DOM patch
    // a runtime toggle already uses — see buildLayers()'s own comment for
    // why Syncfusion is never fed a real `visible: false` directly, at
    // build time or refresh time, and why this DOM-level correction is
    // what actually hides a layer instead. `(loaded)` also fires after
    // every REBUILD (a style switch, Reset, a full reload), not just the
    // very first one — calling this unconditionally here (rather than only
    // from render(), which no-ops before mapInstance exists) is what makes
    // a layer that starts unchecked actually start hidden on first paint,
    // not just once a later toggle happens to run syncLayerDomVisibility()
    // for unrelated reasons.
    this.syncLayerDomVisibility();
    this.animateNavigationLines();
    // See lastKnownGoodZoom's own comment — re-anchored on every rebuild,
    // since a fresh rebuild is confirmed to always land on the configured
    // view correctly (only a later zoom GESTURE can drift onto a bad
    // Syncfusion-reported value, never the rebuild itself).
    if (this.baseConfig?.mapCenter && typeof this.configuredZoomFactor === "number") {
      this.lastKnownGoodZoom = { center: this.baseConfig.mapCenter, zoomFactor: this.configuredZoomFactor };
    }
    // See suppressZoomCenterOverride's own comment. NOT cleared immediately
    // here — confirmed live that a late zoomComplete can still fire (and
    // onZoomComplete()'s own 250ms settle delay adds more room for one)
    // after `loaded` but before Syncfusion's own center-position transition
    // has actually finished landing on the fresh configured center — a
    // reset left zoom LEVEL correctly at the configured value but center
    // stuck on the pre-reset off-center position, meaning the guard had
    // already cleared and let that late zoomComplete's override slip
    // through and lock in the still-transitioning (old) center. A trailing
    // delay past `loaded`, comfortably longer than onZoomComplete()'s own
    // 250ms settle window, is the difference this time.
    clearTimeout(this.suppressZoomCenterOverrideTimer);
    this.suppressZoomCenterOverrideTimer = setTimeout(() => {
      this.suppressZoomCenterOverride = false;
    }, 800);
  }

  private zoomRefreshTimer: ReturnType<typeof setTimeout> | undefined;

  // Verified against a live render (not just theorized): after a real zoom
  // (double-click, wheel, or the toolbar), Syncfusion drops the marker DOM
  // elements for every marker-bearing layer except one — e.g. the base
  // layer's 13 markers vanish entirely while alwusta's 3 remain — even
  // though mapOptions/markerSettings never changed. Calling the Maps
  // component's OWN refresh() (no mapOptions/builder involvement) restores
  // them without resetting the current zoom scale, so this is Syncfusion's
  // own internal render/model desync after a zoom transform, not a data
  // problem on our side.
  //
  // zoomComplete can fire once per wheel tick during continuous scrolling —
  // an earlier version of this handler called refresh() on every tick via
  // the shared render() helper (an un-cancelled setTimeout chain), which
  // stacked up overlapping refreshes during continuous zooming and made the
  // map go blank after enough steps. Clearing the previous timer before
  // scheduling a new one — so only ONE refresh ever fires, after zooming
  // has actually settled — is what's different this time.
  //
  // Open bug: after zooming toward some point other than the map's
  // configured center, the view snaps back to that original center once
  // zooming settles (zoom LEVEL stays correct, only the pan target is
  // lost) — reported on "Map"/"Satellite" (tile) base-map types.
  //
  // A first attempt at fixing this here — capturing mapInstance.centerPosition
  // before refresh() and re-applying it via zoomByPosition() afterward —
  // made things WORSE (confirmed live: it broke "shape" base-map zooming
  // too, previously unaffected) and was reverted. Root cause: centerPosition
  // reads back correctly when a zoom was itself DRIVEN by zoomByPosition()
  // (confirmed live), but apparently does NOT reflect the map's actual
  // pan/center after a real interactive wheel/toolbar zoom — so capturing
  // and reapplying it was forcing the view back to a stale (effectively
  // default) center on every zoom, for every base-map type.
  //
  // This second attempt is narrower, specifically to avoid repeating that
  // exact regression: it only runs for TILE maps (isTileMap — "shape" mode
  // is never touched by this branch at all, structurally, not just by
  // condition), and instead of trusting centerPosition, it derives the
  // live center from the map's own getTileGeoLocation() (a public
  // Syncfusion API converting a pixel coordinate back to lat/long) at the
  // CENTER of the currently-visible map area (mapAreaRect) — reasoning
  // being that whatever pixel-space state a real wheel zoom DOES update
  // (translatePoint/tileTranslatePoint, confirmed live those change during
  // interaction) should still be reflected there, unlike centerPosition.
  //
  // UNVERIFIED — could not confirm this live: two different well-formed
  // synthetic WheelEvent dispatches (including setting the legacy
  // wheelDelta property Syncfusion's handler reads) produced no zoom
  // change at all against the running instance, so the actual interactive
  // zoom code path couldn't be exercised through this automation
  // environment. Needs real-browser confirmation; revert this block back
  // to the plain refresh()-only version above if it makes things worse
  // again, same as last time.
  onZoomComplete(): void {
    clearTimeout(this.zoomRefreshTimer);
    this.zoomRefreshTimer = setTimeout(() => {
      if (this.mapInstance) {
        const inst = this.mapInstance as any;
        // See suppressZoomCenterOverride's own comment — skipped entirely
        // (not just the derivation, the whole override) while a style
        // switch/Reset's destroy-recreate cycle is in flight, so this
        // fix doesn't fight over the view with that correct rebuild.
        //
        // Deliberately NOT `inst.isTileMap` (Syncfusion's own instance
        // flag) — confirmed live that it reads false on the very FIRST
        // zoomComplete after any rebuild even for a genuine tile
        // (osm/satellite) main layer, which was silently skipping the
        // zoomByPosition() correction below on exactly the one event
        // that most needed it (the plausibility check further down
        // already runs unconditionally and computes the right corrected
        // value regardless, but it never got applied to the camera
        // without this). this.mapStyle is our own tracked config, always
        // correct regardless of Syncfusion's own internal readiness.
        const expectingTileMap = this.mapStyle === "osm" || this.mapStyle === "satellite";
        const isTileMap = !this.suppressZoomCenterOverride && expectingTileMap;
        let liveCenter: { latitude: number; longitude: number } | null = null;
        const liveZoomFactor = inst.zoomSettings?.zoomFactor;

        if (isTileMap && typeof inst.getTileGeoLocation === "function" && inst.mapAreaRect) {
          const centerX = inst.mapAreaRect.x + inst.mapAreaRect.width / 2;
          const centerY = inst.mapAreaRect.y + inst.mapAreaRect.height / 2;
          const geo = inst.getTileGeoLocation(centerX, centerY);
          if (geo && geo.latitude != null && geo.longitude != null) {
            liveCenter = { latitude: geo.latitude, longitude: geo.longitude };
          }
        }

        // Confirmed live (console-verified against the running instance,
        // not theorized): Syncfusion's own zoomSettings.zoomFactor AND
        // tileZoomLevel — two independent fields that otherwise always
        // agree with each other — can BOTH simultaneously report an
        // implausible reading on some zoom events (observed: a jump from
        // 8 straight to 2 on the very next double-click after a perfectly
        // correct Reset, no legitimate interaction that large). This is
        // Syncfusion's own internal zoom-tracking glitching, not a wrong-
        // field misread on our side — both fields being wrong the same
        // way rules that out. A single double-click/wheel zoom step only
        // ever moves the level by ~1, so anything further than that from
        // lastKnownGoodZoom (itself only ever updated from a reading we
        // judged plausible, seeded fresh and correct on every rebuild by
        // onMapLoaded()) is rejected — falling back to reapplying the
        // last GOOD center/zoom via zoomByPosition() below instead of the
        // bad reading, which actively corrects Syncfusion's own already-
        // corrupted internal state rather than just leaving it broken.
        const plausible =
          typeof liveZoomFactor === "number" &&
          (!this.lastKnownGoodZoom || Math.abs(liveZoomFactor - this.lastKnownGoodZoom.zoomFactor) <= 2);
        // TEMP DIAGNOSTIC — confirms the rejection branch actually fires.
        // Remove once confirmed.
        if (isTileMap && !plausible) {
          // eslint-disable-next-line no-console
          console.log("[zoom] REJECTED implausible reading", { liveZoomFactor, lastKnownGoodZoom: this.lastKnownGoodZoom });
        }
        const effectiveZoomFactor = plausible ? liveZoomFactor : this.lastKnownGoodZoom?.zoomFactor;
        const effectiveCenter = plausible ? liveCenter : this.lastKnownGoodZoom?.center ?? liveCenter;
        if (isTileMap && plausible && liveCenter && typeof liveZoomFactor === "number") {
          this.lastKnownGoodZoom = { center: liveCenter, zoomFactor: liveZoomFactor };
        }

        // Feeds this zoom's real level into MapGroup.minZoomLevel/
        // MapPoint.minZoomLevel's own threshold check
        // (NXMapBuilderService.buildMarkerPoints()) — builder.refresh()
        // regenerates mapOptions.layers[i].markerSettings from the
        // builder's own state (same pattern every other runtime toggle in
        // this component already uses — toggleGroup/toggleLayer/etc.),
        // which is what actually adds/drops a marker across a threshold;
        // the mapInstance.refresh() right after just repaints from that
        // freshly rebuilt mapOptions, same as it always did for the
        // marker-vanishing-after-zoom bug this handler already exists for.
        if (typeof effectiveZoomFactor === "number" && this.mapOptions) {
          this.builder.setZoomLevel(effectiveZoomFactor);
          this.builder.refresh(this.mapOptions);
        }

        this.mapInstance.refresh();
        this.syncLayerDomVisibility();
        this.animateNavigationLines();
        // refresh() regenerates Syncfusion's own toolbar SVG (Reset button
        // included), which used to silently orphan a listener attached
        // directly to that button — wireResetButton() now delegates from
        // the host element instead (see its own comment), so no re-wiring
        // is needed here regardless of how many times the toolbar DOM gets
        // replaced.

        if (isTileMap && effectiveCenter && typeof effectiveZoomFactor === "number" && typeof inst.zoomByPosition === "function") {
          inst.zoomByPosition(effectiveCenter, effectiveZoomFactor);
        }
      }
    }, 250);
  }

  // zoomSettings.resetToInitial governs whether Syncfusion's own toolbar
  // Reset button is active at all, but what it restores to is Syncfusion's
  // own notion of "initial" — UNVERIFIED in this Syncfusion version against
  // our configured mapCenter/zoomFactor (e.g. an OSM main layer's initial
  // view), and per your testing it does NOT match. Wiring our own click
  // listener onto the same button guarantees Reset always lands on exactly
  // what buildZoom()/buildMap() configured, regardless of what Syncfusion's
  // internal Reset does on its own — this runs a moment AFTER Syncfusion's
  // own reset handler, as a correction, not a replacement.
  //
  // Delegated from the component's own host element — which Syncfusion
  // never destroys — rather than attached directly to the Reset button
  // itself. refresh() (every zoomComplete, see onZoomComplete()) and the
  // full destroy/recreate in applyBaseMapStyle() both regenerate the
  // toolbar's SVG DOM wholesale; a listener attached to the OLD button
  // node is silently orphaned by either, which is why Reset used to stop
  // running our correction after the first zoom of a session and fall
  // through to Syncfusion's own uncorrected "reset to initial" (scale 1,
  // wrong center). Delegation means the listener never needs re-attaching
  // no matter how many times the button underneath gets replaced — this
  // only needs to run once, in ngAfterViewInit().
  private wireResetButton(): void {
    const host = this.elRef.nativeElement;
    host.addEventListener("click", (event: Event) => {
      const target = event.target as Element | null;
      const matched = !!target?.closest('[id*="_Reset"], [title="Reset"]');
      // TEMP DIAGNOSTIC — checking whether a double-click's second click
      // is landing on/near the toolbar and matching this delegated
      // selector, silently triggering an unwanted Reset. Remove once
      // confirmed either way.
      // eslint-disable-next-line no-console
      console.log("[reset] host click", { tag: target?.tagName, id: target?.id, matched });
      if (matched) {
        setTimeout(() => this.resetToConfiguredView(), 50);
      }
    });
  }

  // Re-applies the CURRENT base-map style via applyBaseMapStyle() — same
  // centerPosition (mainConfig.mapCenter, handled by the normal
  // rebuildMap()/buildMap() pipeline) and same zoomFactor rule as a genuine
  // style switch (1 for shape, this.configuredZoomFactor for a tile style),
  // so Reset lands on exactly what buildZoom()/buildMap() would compute
  // fresh — not just whatever Syncfusion's own zoomSettings @Input happens
  // to hold after however much manual zooming/panning happened since.
  private resetToConfiguredView(): void {
    this.applyBaseMapStyle(this.mapStyle);
  }

  // Draws each navigation line's path from start to end instead of having
  // it simply appear — a pure-CSS stroke-dashoffset reveal over Syncfusion's
  // own rendered <path> elements (Syncfusion's NavigationLineSettings has no
  // built-in "animate the drawing" option, only animationDuration for
  // markers/layers — see nx-map-builder.service.ts's buildNavigationLines).
  // Element ids are UNVERIFIED against a live click/render in this
  // Syncfusion version (same caveat as resolveClickedGraphic's id parsing);
  // if lines don't animate, console.log the actual rendered <path> ids
  // under .map-container svg and adjust the selector below.
  private animateNavigationLines(): void {
    const host = this.elRef.nativeElement;
    const paths = host.querySelectorAll(
      'path[id*="NavigationLineIndex"]'
    ) as NodeListOf<SVGPathElement>;

    paths.forEach(path => {
      const length = path.getTotalLength();
      path.style.transition = "none";
      path.style.strokeDasharray = `${length}`;
      path.style.strokeDashoffset = `${length}`;
      // Force layout so the browser registers the dash-offset above before
      // the transition below is applied — otherwise both changes get
      // batched into one paint and there's nothing to animate from.
      path.getBoundingClientRect();
      path.style.transition = "stroke-dashoffset 1.2s ease-in-out";
      requestAnimationFrame(() => {
        path.style.strokeDashoffset = "0";
      });
    });
  }

  // Fallback for the (rare) case Syncfusion's own resize event doesn't
  // fire — delayed so it runs after Syncfusion's internal handling too,
  // for the same reason as onMapResize().
  @HostListener("window:resize")
  onWindowResize(): void {
    setTimeout(() => this.alignLayerControl(), 150);
  }

  // Closes the layer-list panel on any click outside .layer-control OR
  // .layer-panel specifically — NOT the whole component host, which also
  // wraps the map itself; using the host element here would make clicking
  // the map a no-op instead of closing the panel. .layer-panel is checked
  // separately because it's rendered as a SIBLING of .layer-control (pinned
  // to the map's right edge independently of the button's position), not
  // nested inside it — a click on a checkbox inside the panel would
  // otherwise register as "outside" and close it immediately.
  //
  // The base-map dropdown (.basemap-panel) needs no such sibling check — it
  // IS nested inside .basemap-control, so containment on the control alone
  // covers a click on any of its own options too.
  @HostListener("document:click", ["$event"])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as Node;

    if (this.layerPanelOpen) {
      const layerControl = this.elRef.nativeElement.querySelector(".layer-control");
      const layerPanel = this.elRef.nativeElement.querySelector(".layer-panel");
      const insideControl = layerControl?.contains(target) ?? false;
      const insidePanel = layerPanel?.contains(target) ?? false;
      if (!insideControl && !insidePanel) {
        this.layerPanelOpen = false;
      }
    }

    if (this.basemapPanelOpen) {
      const basemapControl = this.elRef.nativeElement.querySelector(".basemap-control");
      if (!(basemapControl?.contains(target) ?? false)) {
        this.basemapPanelOpen = false;
      }
    }
  }

  toggleLayerPanel(): void {
    this.layerPanelOpen = !this.layerPanelOpen;
    if (this.layerPanelOpen) {
      // Recompute in case the window was resized while the panel was
      // closed (no resize listener runs the calc for a hidden element).
      this.alignLayerControl();
    }
  }

  // Positions the layer control's top/right using the REAL rendered
  // position of Syncfusion's own zoom toolbar, rather than a guessed fixed
  // offset. The toolbar's on-screen position depends on the map's rendered
  // aspect ratio (which can letterbox within its container), so a
  // hardcoded CSS offset drifts out of alignment at different viewport
  // sizes — measuring the actual element is the only reliable fix.
  private alignLayerControl(): void {
    const host = this.elRef.nativeElement;
    const toolbar = host.querySelector('[id*="Zooming_ToolBar"]') as Element | null;
    const container = host.querySelector(".map-container") as HTMLElement | null;
    if (!toolbar || !container) {
      return;
    }

    const toolbarRect = toolbar.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    this.layerBtnTop = Math.max(0, toolbarRect.top - containerRect.top);
    this.layerBtnRight = Math.max(0, containerRect.right - toolbarRect.left + 8);

    // Panel spans from just under the button down to the map's actual
    // bottom edge — "available height", not a guessed vh percentage —
    // so it fills the map's own remaining vertical space and scrolls
    // internally once content exceeds that.
    const buttonHeight = 36;
    const gapBelowButton = 6;
    const bottomMargin = 8;
    this.panelTop = this.layerBtnTop + buttonHeight + gapBelowButton;
    this.panelMaxHeight = Math.max(
      120,
      containerRect.height - this.panelTop - bottomMargin
    );
  }
}
