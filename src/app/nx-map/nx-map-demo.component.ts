import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  Input,
  OnChanges,
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
import { LayerFileEnvelope, MapConfig, MapDonutSelection, MapGroup, MapOptions, PointMetric, TooltipTemplateConfig, TooltipTemplateItem } from "./model/nx-map-model";
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

@Component({
  selector: "app-nx-map-demo",
  templateUrl: "./nx-map-demo.component.html",
  styleUrls: ["./nx-map-demo.component.scss"]
})
export class NxMapDemoComponent implements OnChanges, AfterViewInit {
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

  // Furthest-left of the three controls — same chained-offset pattern as
  // basemapBtnRight above.
  get maximizeBtnRight(): number {
    return this.basemapBtnRight + 36 + 8;
  }

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
            // (LayerFileLists/LayerAPIURL/LayerInlineConfig), resolved and
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
              of(appConfig.layerInlineConfig ?? [])
            ]).pipe(
              map(([fileLayers, apiLayers, inlineLayers]) =>
                [...fileLayers, ...apiLayers, ...inlineLayers].map(envelope => ({
                  config: {
                    ...envelope.layerConfig,
                    // Defaults to nesting under the base layer in the filter
                    // popup — the envelope's OWN value (set directly inside
                    // its own file/API response/inline block) always wins.
                    parentLayerName: envelope.layerConfig.parentLayerName ?? baseConfig.layerName,
                    participateInFilter: envelope.layerConfig.participateInFilter ?? true
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
        // checked first.
        const tooltipTemplate =
          baseConfig.tooltipTemplate ??
          staticLayers.map((s: { config: MapConfig }) => s.config.tooltipTemplate).find((t: any) => !!t) ??
          DEFAULT_TOOLTIP_TEMPLATE;
        this.injectMarkerTooltipTemplate(tooltipTemplate);
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
  // selected — nothing here ever creates a marker or hides one.
  //
  // donutSelection.selectedId is a metric id (tvp/salt/bsw/h2s/api/flow/
  // other), not a group id — a point carries a reading for a metric via
  // MapPoint.metrics (the always-loaded copy the hover tooltip reads), so
  // this sets activeMetricId on whichever group(s) actually have points
  // carrying that metric (in practice just the mol/MOL group, wherever it
  // happens to live — see the sub-layer AND static-layer loop in
  // applyMetricSelection() below), leaving every other group's
  // activeMetricId cleared. `slices`/`allIds` are unused here — membership
  // is decided per-point (metrics[selectedId] present or not), not by group
  // id list; they only exist on MapDonutSelection for shape-parity with
  // DonutSelectionEvent.
  //
  // Every point already carries its own reading for every metric
  // (MapPoint.metrics, loaded once as part of the normal group fetch) — a
  // donut selection just re-keys THIS metric's readings by point id from
  // data already on hand, no separate per-metric endpoint/file needed. A
  // null/unset donutSelection, or one with selectedId: null, clears every
  // group's activeMetricId/activeMetricValues.
  private applyDonutSelectionChange(): void {
    const selectedId = this.donutSelection?.selectedId ?? null;
    if (!selectedId) {
      this.applyMetricSelection(null, null);
      return;
    }
    this.applyMetricSelection(selectedId, this.extractMetricValues(selectedId));
  }

  // Walks every group's ORIGINAL points (both sub-layer and static-layer
  // snapshots) and picks out this one metric's reading per point id —
  // mirrors the shape a real "give me this metric's values" endpoint would
  // return (Record<pointId, PointMetric>), just sourced from the points'
  // own already-loaded metrics instead of a second round-trip.
  private extractMetricValues(selectedId: string): Record<string, PointMetric> {
    const values: Record<string, PointMetric> = {};
    const collectFrom = (groups: MapGroup[]) => {
      for (const g of groups) {
        for (const p of g.markerConfig?.points ?? []) {
          const metric = p.metrics?.[selectedId];
          if (metric && p.id) {
            values[p.id] = metric;
          }
        }
      }
    };
    this.staticLayerGroupsOriginal.forEach(collectFrom);
    return values;
  }

  // Shared by applyDonutSelectionChange()'s clear (selectedId: null, no fetch
  // needed) and fetched-response paths — stamps activeMetricId/
  // activeMetricValues onto whichever groups actually have a point carrying
  // `selectedId`, deriving from each layer's own ORIGINAL groups snapshot
  // (staticLayerGroupsOriginal) so a second selection never builds on top of
  // the previous one's stamped fields.
  private applyMetricSelection(selectedId: string | null, fetchedValues: Record<string, PointMetric> | null): void {
    const applyToGroup = (g: MapGroup): MapGroup => {
      const hasMetric = !!selectedId && (g.markerConfig?.points ?? []).some(p => p.metrics?.[selectedId] !== undefined);
      return { ...g, activeMetricId: hasMetric ? selectedId : null, activeMetricValues: hasMetric ? fetchedValues : null };
    };

    this.staticLayerResults = this.staticLayerResults.map((s, i) => ({
      ...s,
      config: { ...s.config, groups: (this.staticLayerGroupsOriginal[i] ?? []).map(applyToGroup) }
    }));
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
    // here anymore.
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
    return this.matchesSearch(item.region) || item.layers.some(l => this.layerMatchesSearch(l));
  }

  // Tri-state checkbox for a LayerRegionNode — same combineStates()
  // convention as every other parent level, derived purely from its
  // layers' own layerState() (a region has no visibility of its own).
  layerRegionState(region: LayerRegionNode): "checked" | "unchecked" | "indeterminate" {
    return this.combineStates(region.layers.map(l => this.layerState(l)));
  }

  // Cascades show/hide to every layer inside the region — same "click an
  // indeterminate/unchecked folder -> select all" convention as
  // toggleHeading()/toggleShapeFeatureGroup().
  toggleLayerRegion(region: LayerRegionNode): void {
    const shouldShow = this.layerRegionState(region) !== "checked";
    region.layers.forEach(layer => {
      if (layer.isMainLayer) {
        return;
      }
      this.setLayerTreeVisibility(layer, shouldShow);
      this.builder.setLayerVisible(layer.layerIndex, shouldShow);
    });
    this.builder.refresh(this.mapOptions);
    this.render();
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
        child.layers.forEach(l => this.setLayerTreeVisibility(l, visible));
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
      return;
    }
    console.log(`You selected ${graphic.groupName}`, graphic);
    this.showToast(`You clicked "${graphic.object.name || "Item"}" in "${graphic.groupName}"`);
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
    // Syncfusion renders the zoom toolbar asynchronously after the
    // component initializes — give it a moment before measuring.
    setTimeout(() => {
      this.alignLayerControl();
    }, 300);
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
  // object). Every tile below is real per-marker data — toMarker() in
  // nx-map-builder.service.ts precomputes v_/u_/c_/v2_/u2_/d2_/v3_/u3_/
  // d3_<key> fields for each of the 7 known metric ids, since Syncfusion's
  // ${field} template substitution can't loop over MapPoint.metrics
  // directly. `config` (MapConfig.tooltipTemplate, or
  // NXMapBuilderService.DEFAULT_TOOLTIP_TEMPLATE) decides which metrics
  // appear, in what order, under what title, and how many tiles per row —
  // rebuilding this element's innerHTML is enough to change the tooltip's
  // whole layout, no other code path involved. Called again every time
  // loadMap() resolves a fresh baseConfig (rebuildMap(), style switches,
  // Reset...) — cheap (a handful of string concatenation) and keeps the
  // template in sync if the config's tooltipTemplate ever changes.
  private injectMarkerTooltipTemplate(config: TooltipTemplateConfig): void {
    let container = document.getElementById("marker-tooltip-template");
    if (!container) {
      container = document.createElement("div");
      container.id = "marker-tooltip-template";
      container.style.display = "none";
      document.body.appendChild(container);
    }

    const columns = Math.max(1, config.columns);
    const rows: string[] = [];
    for (let i = 0; i < config.items.length; i += columns) {
      const cells = config.items
        .slice(i, i + columns)
        .map(item => this.tooltipTileHtml(item))
        .join("");
      rows.push(`<div class="mtt-row">${cells}</div>`);
    }

    container.innerHTML = `
      <div class="marker-tooltip">
        <div class="mtt-header">
          <span class="mtt-title">\${name}</span>
        </div>
        ${rows.join("")}
      </div>
    `;
  }

  // One tooltip tile — title is config-level (same text for every marker,
  // baked in now), value/unit/color are per-marker ${field} placeholders
  // resolved by Syncfusion at hover time.
  private tooltipTileHtml(item: TooltipTemplateItem): string {
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
    this.animateNavigationLines();
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
        const isTileMap = !this.suppressZoomCenterOverride && !!inst.isTileMap;
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

        this.mapInstance.refresh();
        this.syncLayerDomVisibility();
        this.animateNavigationLines();
        // refresh() regenerates Syncfusion's own toolbar SVG (Reset button
        // included), which used to silently orphan a listener attached
        // directly to that button — wireResetButton() now delegates from
        // the host element instead (see its own comment), so no re-wiring
        // is needed here regardless of how many times the toolbar DOM gets
        // replaced.

        if (isTileMap && liveCenter && typeof inst.zoomByPosition === "function") {
          inst.zoomByPosition(liveCenter, liveZoomFactor);
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
      if (target?.closest('[id*="_Reset"], [title="Reset"]')) {
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
