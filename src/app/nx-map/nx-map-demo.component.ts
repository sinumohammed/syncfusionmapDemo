import { AfterViewInit, Component, ElementRef, HostListener, OnInit, ViewChild } from "@angular/core";
import { forkJoin, of } from "rxjs";
import { map } from "rxjs/operators";
import {
  Maps,
  MapsComponent,
  Marker,
  DataLabel,
  MapsTooltip,
  NavigationLine,
  Polygon,
  Zoom,
  IMarkerClickEventArgs
} from "@syncfusion/ej2-angular-maps";
import { MapConfig, MapGroup, MapOptions } from "./model/nx-map-model";
import { NXMapAppConfig } from "./model/nx-map-app-config";
import { GroupEntry, HeadingNode, LayerTreeNode, NXMapBuilderService } from "./services/nx-map-builder.service";
import { NXMapConfigService } from "./services/nx-map-config.service";
import * as pdoMapConfig from "./data/pdo-map-config.json";

// Marker clustering needs no separate module — it's part of Marker, driven
// entirely by each marker group's `clusterSettings` (see the builder
// service). Injecting Marker is enough.
Maps.Inject(Zoom, Marker, DataLabel, MapsTooltip, NavigationLine, Polygon);

@Component({
  selector: "app-nx-map-demo",
  template: `
    <div class="nx-map-demo">
      <!-- Layer control, placed before ejs-maps in the DOM and positioned
           just left of the Maps zoom toolbar. Fully custom (no Syncfusion
           dropdown component) — a plain button + panel is far less fragile
           than fighting a 3rd-party popup's own stacking/positioning.

           Three toggle levels, each independent:
             - layer checkbox   -> hides the whole region (shape + everything
                                   in it), via setLayerVisible()
             - group checkbox   -> hides that group's markers/lines/polygons/
                                   circles, layer itself stays visible
             - item checkbox    -> hides one specific marker/polygon/circle/
                                   line, its group stays visible
           <details>/<summary> gives expand/collapse for free, no JS state
           needed to track which nodes are open. -->
      <div class="layer-control" [style.top.px]="layerBtnTop" [style.right.px]="layerBtnRight">
        <button
          type="button"
          class="layer-btn"
          title="Map layers"
          (click)="toggleLayerPanel()"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
            <path d="M12 3 2 8l10 5 10-5-10-5Z" fill="#5f6368" />
            <path d="M2 12l10 5 10-5" stroke="#5f6368" stroke-width="1.6" fill="none" />
            <path d="M2 16l10 5 10-5" stroke="#5f6368" stroke-width="1.6" fill="none" />
          </svg>
        </button>
      </div>

      <!-- Positioned independently from .layer-control (not nested inside
           it): the button's own left offset tracks Syncfusion's zoom
           toolbar, but the panel itself is pinned to the map's actual right
           edge and stretched down to the map's actual bottom edge — it
           would otherwise inherit the button's (usually much larger)
           inward offset and end up narrower / not flush with the edge. -->
      <div
        class="layer-panel"
        *ngIf="layerPanelOpen"
        [style.top.px]="panelTop"
        [style.max-height.px]="panelMaxHeight"
      >
          <div class="layer-panel-header">
            <span class="layer-panel-title">Layer List</span>
            <button type="button" class="icon-btn" title="Close" (click)="layerPanelOpen = false">
              ✕
            </button>
          </div>

          <!-- Manual test trigger for reloadSubLayerGroups() — no auto-firing
               anywhere; this is the only thing that calls it. Alternates
               between the full 2-group mock response and a partial 1-group
               one (Surface dropped) each click, purely so clicking it twice
               visibly proves the reload REPLACES the previous sub-layer
               groups (Surface disappears from this popup, not just stops
               rendering on the map) rather than appending to them — wire a
               real payload/endpoint here when a live backend exists. -->
          <div class="layer-panel-testbar">
            <button type="button" class="reload-btn" (click)="reloadSubLayerGroupsDemo()">
              Reload Sub-Layers ({{ subLayerDemoAlt ? "partial" : "full" }} → click for {{ subLayerDemoAlt ? "full" : "partial" }})
            </button>
          </div>

          <div class="layer-panel-subheader">Layers</div>

          <div class="layer-panel-search">
            <input
              type="text"
              placeholder="Search layers, groups, markers…"
              [value]="filterText"
              (input)="filterText = $any($event.target).value"
            />
          </div>

          <div class="layer-panel-body">
            <ng-container *ngFor="let layer of layerTree">
              <ng-container *ngIf="layerMatchesSearch(layer)">
                <ng-container *ngTemplateOutlet="layerNodeTpl; context: { layer: layer }"></ng-container>
              </ng-container>
            </ng-container>
          </div>
      </div>

      <!-- A group entry's own checkbox+label row — factored out so both
           branches below (expandable vs leaf-only) render the exact same
           markup instead of duplicating the checkbox bindings. -->
      <ng-template #groupSummaryTpl let-entry="entry" let-layer="layer">
        <label (click)="$event.stopPropagation()">
          <input
            type="checkbox"
            [checked]="groupState(entry) === 'checked'"
            [indeterminate]="groupState(entry) === 'indeterminate'"
            (click)="$event.stopPropagation(); toggleGroup(entry, layer)"
          />
          {{ entry.group.name }}
        </label>
      </ng-template>

      <!-- Reused for every group leaf, whether it's an ungrouped
           layer.groups entry or nested inside a heading — a group's own
           checkbox plus its flat marker/polygon/circle/line leaves. A group
           with no markers/polygons/circles/lines at all (groupHasLeaves()
           false) has nothing to expand, so it renders as a plain row
           instead — a <details> here would otherwise still show its
           disclosure arrow even though opening it reveals nothing. -->
      <ng-template #groupEntryTpl let-entry="entry" let-layer="layer">
        <details class="tree-indent" open *ngIf="groupHasLeaves(entry); else groupLeafRow">
          <summary>
            <ng-container *ngTemplateOutlet="groupSummaryTpl; context: { entry: entry, layer: layer }"></ng-container>
          </summary>

          <div class="tree-indent leaves">
            <ng-container *ngFor="let m of entry.markers">
              <label *ngIf="matchesSearch(m.name || 'Marker')">
                <input
                  type="checkbox"
                  [checked]="m.visible !== false"
                  (click)="toggleLeaf(m, entry.group, layer)"
                />
                {{ m.name || "Marker" }}
              </label>
            </ng-container>
            <ng-container *ngFor="let p of entry.polygons">
              <label *ngIf="matchesSearch(p.name || 'Polygon')">
                <input
                  type="checkbox"
                  [checked]="p.visible !== false"
                  (click)="toggleLeaf(p, entry.group, layer)"
                />
                {{ p.name || "Polygon" }}
              </label>
            </ng-container>
            <ng-container *ngFor="let c of entry.circles">
              <label *ngIf="matchesSearch(c.name || 'Circle')">
                <input
                  type="checkbox"
                  [checked]="c.visible !== false"
                  (click)="toggleLeaf(c, entry.group, layer)"
                />
                {{ c.name || "Circle" }}
              </label>
            </ng-container>
            <ng-container *ngFor="let l of entry.lines; let i = index">
              <label *ngIf="matchesSearch('Line ' + (i + 1))">
                <input
                  type="checkbox"
                  [checked]="l.visible !== false"
                  (click)="toggleLeaf(l, entry.group, layer)"
                />
                Line {{ i + 1 }}
              </label>
            </ng-container>
          </div>
        </details>
        <ng-template #groupLeafRow>
          <div class="tree-indent no-children">
            <ng-container *ngTemplateOutlet="groupSummaryTpl; context: { entry: entry, layer: layer }"></ng-container>
          </div>
        </ng-template>
      </ng-template>

      <!-- A layer node's own checkbox+label row — factored out for the same
           reason as groupSummaryTpl above. -->
      <ng-template #layerSummaryTpl let-layer="layer">
        <label
          (click)="$event.stopPropagation()"
          [title]="layer.isMainLayer ? 'Main layer — always visible' : ''"
        >
          <input
            type="checkbox"
            [checked]="layerState(layer) === 'checked'"
            [indeterminate]="layerState(layer) === 'indeterminate'"
            [disabled]="layer.isMainLayer"
            (click)="$event.stopPropagation(); toggleLayer(layer)"
          />
          {{ layer.displayName }}{{ layer.isMainLayer ? " (main)" : "" }}
        </label>

        <!-- Test-only control: switches this layer's theme at runtime (no
             config-file edit needed) so the cascade (group -> layer ->
             app-wide -> "default") can be tried live. "Inherit" maps to
             undefined, same as never setting MapConfig.theme at all. -->
        <select
          class="theme-select"
          [title]="'Theme for ' + layer.displayName"
          (click)="$event.stopPropagation()"
          (change)="onLayerThemeChange(layer, $any($event.target).value)"
        >
          <!-- [selected] set explicitly on each option, rather than relying
               on the <select>'s own [value] to match against options
               rendered by *ngFor below — a plain [value] binding on the
               select can desync here: once Angular sets it to a string
               that's unchanged on a later check, it skips re-applying the
               DOM property, even if that first attempt happened before the
               *ngFor options existed yet to match against. -->
          <option value="" [selected]="!layer.themeName">Inherit</option>
          <option *ngFor="let name of themeNames" [value]="name" [selected]="layer.themeName === name">{{ name }}</option>
        </select>
      </ng-template>

      <!-- One layer node: its own summary checkbox, its ungrouped groups,
           its toggleable heading sections (each bucketing groups from a
           sub-layer API call), and any nested child layers (e.g. static
           layers nested under the base/Oman layer) — rendered by calling
           this same template again, so nesting depth isn't hardcoded. A
           layer with none of the above (layerHasContent() false — e.g. a
           static layer configured with groups: []) has nothing to expand,
           so it renders as a plain row instead of a <details> that would
           still show a disclosure arrow over an empty panel. -->
      <ng-template #layerNodeTpl let-layer="layer">
        <details open *ngIf="layerHasContent(layer); else layerLeafRow">
          <summary>
            <ng-container *ngTemplateOutlet="layerSummaryTpl; context: { layer: layer }"></ng-container>
          </summary>

          <ng-container *ngFor="let entry of layer.groups">
            <ng-container *ngIf="groupMatchesSearch(entry)">
              <ng-container *ngTemplateOutlet="groupEntryTpl; context: { entry: entry, layer: layer }"></ng-container>
            </ng-container>
          </ng-container>

          <ng-container *ngFor="let h of layer.headings">
            <details class="tree-indent" *ngIf="headingMatchesSearch(h)" open>
              <summary>
                <label (click)="$event.stopPropagation()">
                  <input
                    type="checkbox"
                    [checked]="headingState(h) === 'checked'"
                    [indeterminate]="headingState(h) === 'indeterminate'"
                    (click)="$event.stopPropagation(); toggleHeading(h, layer)"
                  />
                  {{ h.heading }}
                </label>
              </summary>
              <ng-container *ngFor="let entry of h.groups">
                <ng-container *ngIf="groupMatchesSearch(entry)">
                  <ng-container *ngTemplateOutlet="groupEntryTpl; context: { entry: entry, layer: layer }"></ng-container>
                </ng-container>
              </ng-container>
            </details>
          </ng-container>

          <ng-container *ngFor="let child of layer.children">
            <div class="tree-indent" *ngIf="layerMatchesSearch(child)">
              <ng-container *ngTemplateOutlet="layerNodeTpl; context: { layer: child }"></ng-container>
            </div>
          </ng-container>
        </details>
        <ng-template #layerLeafRow>
          <div class="no-children">
            <ng-container *ngTemplateOutlet="layerSummaryTpl; context: { layer: layer }"></ng-container>
          </div>
        </ng-template>
      </ng-template>

      <!-- Binding the whole [layers] array (rather than one <e-layer> per
           mapOptions.layers[i]) is what lets this render N Syncfusion
           layers for N MapConfig entries — one per genuinely distinct
           shapeData/region, e.g. Musandam + Dhofar + Al Wusta stacked on
           the base Oman layer. Groups (Facilities/Surface/...) still live
           WITHIN each layer's markerSettings/polygonSettings — they don't
           need separate Syncfusion layers, so toggling them never has the
           "one layer hides another" occlusion problem real layers can have
           when they geographically overlap. -->
      <ejs-maps
        class="map-container"
        *ngIf="mapOptions?.layers?.length"
        #mapInstance
        width="100%"
        height="100%"
        [titleSettings]="mapOptions?.titleSettings"
        [zoomSettings]="mapOptions?.zoomSettings"
        [centerPosition]="mapOptions?.centerPosition"
        [layers]="mapOptions?.layers"
        (markerClick)="onMarkerClick($event)"
        (click)="onMapClick($event)"
        (resize)="onMapResize()"
        (loaded)="onMapLoaded()"
        (zoomComplete)="onZoomComplete()"
      >
      </ejs-maps>

      <!-- On-screen equivalent of the console.log in onMarkerClick()/
           onMapClick() — appears briefly over the map on a marker/polygon/
           circle click, then clears itself (see showToast()). -->
      <div class="click-toast" *ngIf="toastMessage">
        {{ toastMessage }}
      </div>
    </div>
  `,
  styles: [
    `
      /* The component's own host element (<app-nx-map-demo>) is inline by
         default — needs display:block for a height to apply to it at all,
         and needs an actual height for .nx-map-demo's 100% below to
         resolve against (percentages need a concrete ancestor height all
         the way up; see the html/body/app-root chain in styles.css). */
      :host {
        display: block;
        height: 100%;
        width: 100%;
      }

      .nx-map-demo {
        position: relative;
        height: 100%;
        width: 100%;
      }

      /* Syncfusion's Maps root renders its own internal layers (zoom
         toolbar, tooltip, etc.) with their own z-index values. Pinning the
         map's own stacking context to z-index: 0 here means none of those
         internal layers can ever climb above a sibling that has a higher
         z-index at THIS level — otherwise an internal layer with a high
         z-index can end up on top of the picker even though the picker sits
         later in the DOM. */
      .nx-map-demo ::ng-deep ejs-maps {
        position: relative;
        z-index: 0;
      }

      /* width="100%"/height="100%" on ejs-maps (Syncfusion's own attrs)
         resolve against THIS element's box — so this needs a concrete
         height too, which it now gets from .nx-map-demo's 100% above
         (itself resolving up through :host -> app-root -> body -> html,
         all set to height:100% in styles.css). Fills the parent instead of
         a fixed 600px. */
      .nx-map-demo .map-container {
        display: block;
        height: 100%;
        width: 100%;
      }

      /* top/right are set at runtime (see alignLayerControl()) to match
         wherever Syncfusion actually renders its zoom toolbar — that
         position depends on the map's rendered aspect ratio and isn't a
         fixed pixel offset from the container edge, so a hardcoded value
         here drifts out of alignment depending on viewport size. */
      .nx-map-demo .layer-control {
        position: absolute;
        z-index: 100;
      }

      .nx-map-demo .layer-btn {
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #fff;
        border: none;
        border-radius: 4px;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
        cursor: pointer;
      }

      /* Pinned to the map's own right edge (not the button's position,
         which tracks the zoom toolbar and can sit well inward of the true
         edge). top/max-height are computed at runtime in
         alignLayerControl() to span from just under the button down to
         the map's actual bottom edge, so long content scrolls within that
         space instead of overflowing past the map or the viewport. */
      .nx-map-demo .layer-panel {
        position: absolute;
        right: 8px;
        width: 340px;
        overflow-y: auto;
        background: #fff;
        border-radius: 6px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
        /* Needed now that this is a SIBLING of .map-container (z-index: 0)
           rather than nested inside .layer-control (z-index: 100) — without
           an explicit z-index here, an element with z-index:auto stacks by
           DOM order among same-level (z-index:0) siblings, and .map-container
           comes later in the DOM, so it would paint on top of this panel. */
        z-index: 100;
      }

      .nx-map-demo .layer-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: #1a1a1a;
        color: #fff;
        padding: 10px 12px;
        border-radius: 6px 6px 0 0;
        font-size: 14px;
        font-weight: 600;
      }

      .nx-map-demo .layer-panel-header .icon-btn {
        background: none;
        border: none;
        color: #fff;
        font-size: 14px;
        cursor: pointer;
        padding: 2px 4px;
        line-height: 1;
      }

      .nx-map-demo .layer-panel-subheader {
        padding: 8px 12px 4px;
        font-size: 12px;
        font-weight: 600;
        color: #5f6368;
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }

      .nx-map-demo .layer-panel-testbar {
        padding: 8px 12px 0;
      }

      .nx-map-demo .reload-btn {
        width: 100%;
        padding: 6px 8px;
        font-size: 12px;
        background: #eef3fc;
        border: 1px solid #c3d4f0;
        border-radius: 4px;
        color: #1a73e8;
        cursor: pointer;
      }

      .nx-map-demo .reload-btn:hover {
        background: #e1eaf9;
      }

      .nx-map-demo .layer-panel-search {
        padding: 4px 12px 8px;
      }

      .nx-map-demo .layer-panel-search input {
        width: 100%;
        box-sizing: border-box;
        padding: 6px 8px;
        font-size: 13px;
        border: 1px solid #dadce0;
        border-radius: 4px;
      }

      /* Centered near the top of the map, above the layer control/toolbar
         (z-index higher than both), so it's never covered by either. */
      .nx-map-demo .click-toast {
        position: absolute;
        top: 12px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 200;
        background: rgba(26, 26, 26, 0.92);
        color: #fff;
        padding: 8px 16px;
        border-radius: 6px;
        font-size: 13px;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
        max-width: 80%;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        pointer-events: none;
      }

      .nx-map-demo .layer-panel-body {
        padding: 0 8px 8px;
      }

      .nx-map-demo .layer-panel summary {
        cursor: pointer;
        list-style: revert;
      }

      .nx-map-demo .layer-panel summary label {
        display: inline-flex;
      }

      /* Subtle highlight on an expanded node's own row — mirrors the
         "currently open" row shading in the reference layer list. */
      .nx-map-demo .layer-panel details[open] > summary {
        background: #f1f3f4;
        border-radius: 4px;
      }

      .nx-map-demo .tree-indent {
        margin-left: 16px;
      }

      /* A childless group/layer row (no <details> wrapper, so no native
         disclosure triangle) — matches a <summary>'s own left inset so it
         still lines up with sibling rows that DO have an arrow. */
      .nx-map-demo .no-children {
        margin-left: 1em;
      }

      .nx-map-demo .layer-panel label {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 5px 6px;
        font-size: 13px;
        color: #202124;
        cursor: pointer;
        white-space: nowrap;
      }

      .nx-map-demo .leaves label {
        font-size: 12px;
        color: #5f6368;
      }

      /* Test-only per-layer theme switcher (onLayerThemeChange()) — kept
         small/inline next to the layer's own label so it doesn't compete
         for attention with the actual checkbox tree. */
      .nx-map-demo .layer-panel select.theme-select {
        margin-left: 6px;
        font-size: 11px;
        padding: 1px 3px;
        border: 1px solid #dadce0;
        border-radius: 3px;
        color: #5f6368;
        background: #fff;
        cursor: pointer;
      }

      /* ej2-base's material theme resets native form control styling
         globally, which otherwise makes plain checkboxes render with
         zero visible size — force the browser's default checkbox back on
         for this panel specifically, and tint the checked state so it
         reads clearly against both the highlighted and plain rows. */
      .nx-map-demo .layer-panel input[type="checkbox"] {
        appearance: auto;
        -webkit-appearance: auto;
        accent-color: #1a73e8;
        width: 14px;
        height: 14px;
        margin: 0;
      }

      .nx-map-demo .layer-panel input[type="checkbox"]:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    `
  ]
})
export class NxMapDemoComponent implements OnInit, AfterViewInit {
  // Both assigned outside the constructor (mapInstance by Angular's
  // @ViewChild after view init, mapOptions asynchronously by rebuildMap()
  // once ngOnInit's forkJoin resolves) — every read of either is already
  // guarded (template uses `?.` throughout, TS-side callers check
  // `if (!this.mapOptions)` / `if (this.mapInstance)` before use), so `!`
  // just tells the compiler what's already true at runtime.
  @ViewChild("mapInstance") mapInstance!: MapsComponent;

  mapOptions!: MapOptions;
  layerPanelOpen = false;
  layerTree: LayerTreeNode[] = [];

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

  // Filter-tree search box — plain text, matched case-insensitively against
  // layer/heading/group names and leaf labels (see matchesSearch() and the
  // per-level xMatchesSearch() helpers below).
  filterText = "";

  // Brief on-screen confirmation of the last marker/polygon/circle click —
  // see showToast()/onMarkerClick()/onMapClick().
  toastMessage: string | null = null;

  // Manual test-only toggle for the "Reload Sub-Layers" button — alternates
  // which mock file the demo re-fetches so clicking it visibly proves
  // reloadSubLayerGroups() replaces the previous groups rather than
  // appending to them. Not part of the real reload mechanism itself.
  subLayerDemoAlt = false;

  // pdo-map-config.json is an NXMapAppConfig — a description of WHERE each
  // piece of data comes from (inline/file/api), not the map data itself.
  // See ngOnInit() for how it's resolved into the MapConfig[] the builder
  // service expects.
  private appConfig: NXMapAppConfig = (pdoMapConfig as any).default ?? pdoMapConfig;
  private configs: MapConfig[] = [];

  // Kept as fields (rather than only local variables inside ngOnInit) so
  // reloadSubLayerGroups() can rebuild the map later without re-fetching
  // the base layer/static layers all over again — only subLayerGroups
  // actually changes on a reload.
  private baseConfig: MapConfig | undefined;
  private baseShape: any;
  private staticLayerResults: { config: MapConfig; shape: any }[] = [];
  private subLayerGroups: MapGroup[] = [];

  constructor(
    private builder: NXMapBuilderService,
    private configService: NXMapConfigService,
    private elRef: ElementRef<HTMLElement>
  ) {
    this.themeNames = this.builder.getThemeNames();
  }

  ngOnInit(): void {
    const appConfig = this.appConfig;

    forkJoin({
      baseConfig: this.configService.resolve(appConfig.baseLayerConfigSource),
      baseShape: this.configService.resolveShapeData(appConfig.baseLayerName, appConfig.baseShapeDataSource),
      // Sub-layer groups share the base layer's geography (no shapeData of
      // their own) — the API response(s) are merged straight into the base
      // layer's groups[] below, per nx-map-builder.service.ts's own
      // documented guidance on same-geography categories vs new layers.
      subGroups: this.configService.loadSubLayerGroups(appConfig.subLayerApis),
      // Static (hardcoded) layers each have their own real boundary/shapeData
      // — genuinely separate Syncfusion SubLayers — but are still nested
      // under the base layer in the filter popup via parentLayerName.
      // forkJoin([]) never emits (only completes) — guard the empty case so
      // ngOnInit's subscribe still fires when a deployment has no static
      // layers configured at all.
      staticLayers: appConfig.staticLayers.length
        ? forkJoin(
            appConfig.staticLayers.map(ref =>
              forkJoin({
                config: this.configService.resolve(ref.configSource),
                shape: this.configService.resolveShapeData(ref.layerName, ref.shapeDataSource)
              }).pipe(
                map(({ config, shape }) => ({
                  config: {
                    ...config,
                    parentLayerName: ref.parentLayerName ?? appConfig.baseLayerName,
                    participateInFilter: ref.participateInFilter ?? true
                  },
                  shape
                }))
              )
            )
          )
        : of([])
    }).subscribe(({ baseConfig, baseShape, subGroups, staticLayers }) => {
      this.baseConfig = baseConfig;
      this.baseShape = baseShape;
      this.staticLayerResults = staticLayers;
      this.subLayerGroups = subGroups;
      this.rebuildMap();
    });
  }

  // Re-calls a configured sub-layer API endpoint with a different payload —
  // wire this to whatever "some other action" should refresh the map's
  // dynamic groups (a filter change, a search, etc). The new response
  // REPLACES this.subLayerGroups entirely rather than appending to it, so
  // whatever the endpoint returned last time is fully cleared before the
  // new groups are merged into the base layer and the map/filter tree are
  // rebuilt. `apiIndex` picks which configured endpoint to re-call — 0 (the
  // default) is the only one for today's single-entry subLayerApis config.
  // `urlOverride` exists only for reloadSubLayerGroupsDemo()'s benefit (see
  // below) — a real integration should leave it unset and vary results via
  // `payload` against the one configured URL instead.
  reloadSubLayerGroups(payload?: Record<string, string | number | boolean>, apiIndex = 0, urlOverride?: string): void {
    const api = this.appConfig.subLayerApis[apiIndex];
    if (!api) {
      return;
    }
    const effectiveApi = urlOverride ? { ...api, url: urlOverride } : api;
    this.configService.loadSubLayerGroup(effectiveApi, payload).subscribe(groups => {
      this.subLayerGroups = groups;
      this.rebuildMap();
    });
  }

  // The manual "Reload Sub-Layers" button's click handler — nothing else
  // calls this or reloadSubLayerGroups(). Since the demo's endpoint is a
  // static mock file (not a real backend that would actually vary its
  // response by payload), this alternates the URL itself between the full
  // 2-group response and a partial 1-group one, purely so a click visibly
  // proves the reload REPLACES the previous groups — e.g. the "Surface"
  // heading disappearing from this popup entirely, not just going empty —
  // rather than accumulating duplicates. Swap this for a real
  // endpoint/payload once a live backend exists; reloadSubLayerGroups()
  // itself already re-calls a single configured URL with whatever payload
  // you pass it.
  reloadSubLayerGroupsDemo(): void {
    this.subLayerDemoAlt = !this.subLayerDemoAlt;
    const url = this.subLayerDemoAlt
      ? "assets/mock-api/sublayer-groups-partial.json"
      : "assets/mock-api/sublayer-groups.json";
    this.reloadSubLayerGroups({ demo: this.subLayerDemoAlt ? "partial" : "full" }, 0, url);
  }

  // Shared by the initial load and reloadSubLayerGroups(): recombines
  // whatever's currently in baseConfig/staticLayerResults/subLayerGroups
  // into the MapConfig[] + shapeDataByLayer the builder expects, then
  // rebuilds mapOptions and the filter tree from scratch. A full
  // buildMap() (not just builder.refresh()) is needed here because
  // subLayerGroups changing can add/remove whole groups, not just flip
  // visibility on existing ones.
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
  // so this is a safe no-op on the very first call from ngOnInit (before
  // ngAfterViewInit has run).
  private rebuildMap(): void {
    if (!this.baseConfig) {
      return;
    }
    const mergedBase: MapConfig = {
      ...this.baseConfig,
      isMainLayer: true,
      groups: [...(this.baseConfig.groups ?? []), ...this.subLayerGroups]
    };

    this.configs = [mergedBase, ...this.staticLayerResults.map(s => s.config)];

    const shapeDataByLayer: Record<string, any> = {
      [this.appConfig.baseLayerName]: this.baseShape
    };
    this.staticLayerResults.forEach(s => {
      shapeDataByLayer[s.config.layerName] = s.shape;
    });

    // Every layer/group comes back fully checked (buildMap()'s default) —
    // a reload is a full reset, not a merge with whatever was previously
    // toggled.
    this.mapOptions = this.builder.buildMap(this.configs, shapeDataByLayer, this.appConfig.theme);
    this.layerTree = this.builder.getLayerTree();
    this.render();
  }

  // Whether a group has anything to expand at all — drives groupEntryTpl's
  // choice between a <details> (with its disclosure arrow) and a plain
  // no-arrow row for a group whose markers/polygons/circles/lines are all
  // empty.
  groupHasLeaves(entry: GroupEntry): boolean {
    return this.groupLeaves(entry).length > 0;
  }

  // Whether a layer node has anything to expand at all (groups, headings,
  // or nested child layers) — drives layerNodeTpl's choice between a
  // <details> and a plain no-arrow row for a layer configured with no
  // groups of its own (e.g. a static layer whose config has `groups: []`).
  layerHasContent(layer: LayerTreeNode): boolean {
    return layer.groups.length > 0 || layer.headings.length > 0 || layer.children.length > 0;
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
      layer.children.some(c => this.layerMatchesSearch(c))
    );
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
      ...layer.children.map(c => this.layerState(c))
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
    layer.children.forEach(child => this.setLayerTreeVisibility(child, visible));
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
      ...layer.children.map(c => this.layerState(c))
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

  private render(): void {
    if (this.mapInstance) {
      setTimeout(() => {
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
    this.mapOptions.layers.forEach((_layerSettings, i) => {
      const group = host.querySelector(`[id$="_LayerIndex_${i}"]`) as HTMLElement | null;
      if (group) {
        // builder.refresh() always feeds Syncfusion's OWN layers[i].visible
        // as true (see its comment) — reading it here would show every
        // layer as visible regardless of what the user actually toggled.
        // getLayerVisible() is the real per-layer flag that was never
        // handed to Syncfusion, specifically so its layersCollection never
        // drops/renumbers an entry and desyncs this index-based lookup.
        group.style.display = this.builder.getLayerVisible(i) ? "" : "none";
      }
    });
  }

  ngAfterViewInit(): void {
    // Syncfusion renders the zoom toolbar asynchronously after the
    // component initializes — give it a moment before measuring.
    setTimeout(() => {
      this.alignLayerControl();
      this.wireResetButton();
    }, 300);
  }

  // Syncfusion's own `resize` event fires once ITS internal resize handling
  // (redrawing the SVG, repositioning the zoom toolbar) has actually
  // finished — the reliable trigger to re-measure against, unlike a raw
  // window resize which fires before Syncfusion has caught up (that gap is
  // why the toolbar/layer button could go missing until a full refresh).
  onMapResize(): void {
    setTimeout(() => {
      this.alignLayerControl();
      this.wireResetButton();
    }, 50);
  }

  // Fires once Syncfusion's initial render (shapes, markers, navigation
  // lines) has actually completed — the reliable point to run the one-time
  // "draw" animation on navigation lines and to wire the toolbar's Reset
  // button, both of which need real DOM elements Syncfusion has finished
  // creating.
  onMapLoaded(): void {
    this.wireResetButton();
    this.animateNavigationLines();
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
  onZoomComplete(): void {
    clearTimeout(this.zoomRefreshTimer);
    this.zoomRefreshTimer = setTimeout(() => {
      if (this.mapInstance) {
        this.mapInstance.refresh();
        this.syncLayerDomVisibility();
        this.animateNavigationLines();
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
  // `data-nx-wired` marks the button once found so repeated calls (resize,
  // reload) don't stack duplicate listeners on the same element.
  private wireResetButton(): void {
    const host = this.elRef.nativeElement;
    const resetBtn = host.querySelector(
      '[id*="_Reset"], [title="Reset"]'
    ) as HTMLElement | null;
    if (!resetBtn || resetBtn.dataset["nxWired"]) {
      return;
    }
    resetBtn.dataset["nxWired"] = "true";
    resetBtn.addEventListener("click", () => {
      setTimeout(() => this.resetToConfiguredView(), 50);
    });
  }

  private resetToConfiguredView(): void {
    if (!this.mapOptions) {
      return;
    }
    const mainConfig = this.configs[this.builder.getMainLayerIndex()];
    if (!mainConfig) {
      return;
    }
    this.mapOptions.centerPosition = mainConfig.mapCenter;
    this.mapOptions.zoomSettings = {
      ...this.mapOptions.zoomSettings,
      zoomFactor: mainConfig.zoomFactor
    };
    if (this.mapInstance) {
      setTimeout(() => this.mapInstance.refresh(), 50);
    }
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

  // Closes the panel on any click outside .layer-control OR .layer-panel
  // specifically — NOT the whole component host, which also wraps the map
  // itself; using the host element here would make clicking the map a
  // no-op instead of closing the panel. .layer-panel is checked separately
  // because it's rendered as a SIBLING of .layer-control (pinned to the
  // map's right edge independently of the button's position), not nested
  // inside it — a click on a checkbox inside the panel would otherwise
  // register as "outside" and close it immediately.
  @HostListener("document:click", ["$event"])
  onDocumentClick(event: MouseEvent): void {
    if (!this.layerPanelOpen) {
      return;
    }
    const target = event.target as Node;
    const layerControl = this.elRef.nativeElement.querySelector(".layer-control");
    const layerPanel = this.elRef.nativeElement.querySelector(".layer-panel");
    const insideControl = layerControl?.contains(target) ?? false;
    const insidePanel = layerPanel?.contains(target) ?? false;
    if (!insideControl && !insidePanel) {
      this.layerPanelOpen = false;
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
