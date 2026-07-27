import { AfterViewInit, Component, ElementRef, HostListener, OnInit, ViewChild } from "@angular/core";
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
import { MapConfig, MapOptions } from "./model/nx-map-model";
import { LayerTreeNode, NXMapBuilderService } from "./services/nx-map-builder.service";
import * as pdoMapConfig from "./data/pdo-map-config.json";
import * as omanShape from "./data/oman-shape.json";
import * as alwustaShape from "./data/alwusta-shape.json";

// Marker clustering needs no separate module — it's part of Marker, driven
// entirely by each marker group's `clusterSettings` (see the builder
// service). Injecting Marker is enough.
Maps.Inject(Zoom, Marker, DataLabel, MapsTooltip, NavigationLine, Polygon);

// Rough single-polygon Oman boundary for the demo (properties.name === "Oman"
// matches shapePropertyPath/labelPath below). Swap for the host app's real
// GeoJSON (e.g. maps/oman.json from NXMapDataService) when wiring this back in.
const OMAN_SHAPE_DATA = (omanShape as any).default ?? omanShape;

// Shape data for the second (SubLayer) entry now in pdo-map-config.json
// (layerName: "alwusta") — a rough Al Wusta governorate boundary, to test
// multi-layer rendering: two Syncfusion layers, each with its own shapeData
// and groups, both shown or hidden independently through the layer panel.
const ALWUSTA_SHAPE_DATA = (alwustaShape as any).default ?? alwustaShape;

// Maps each MapConfig's layerName to its shapeData — extend this (or fetch
// per layerName via NXMapDataService + forkJoin) as more layers are added.
const SHAPE_DATA_BY_LAYER_NAME: Record<string, any> = {
  omanv1: OMAN_SHAPE_DATA,
  alwusta: ALWUSTA_SHAPE_DATA
};

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
          <div class="layer-panel-subheader">Layers</div>

          <div class="layer-panel-body">
            <details *ngFor="let layer of layerTree" open>
              <summary>
                <label
                  (click)="$event.stopPropagation()"
                  [title]="layer.isMainLayer ? 'Main layer — always visible' : ''"
                >
                  <input
                    type="checkbox"
                    [checked]="layer.visible"
                    [disabled]="layer.isMainLayer"
                    (click)="$event.stopPropagation(); toggleLayer(layer)"
                  />
                  {{ layer.layerName }}{{ layer.isMainLayer ? " (main)" : "" }}
                </label>
              </summary>

              <details class="tree-indent" *ngFor="let entry of layer.groups" open>
                <summary>
                  <label (click)="$event.stopPropagation()">
                    <input
                      type="checkbox"
                      [checked]="entry.group.visible !== false"
                      (click)="$event.stopPropagation(); toggleVisible(entry.group)"
                    />
                    {{ entry.group.name }}
                  </label>
                </summary>

                <div class="tree-indent leaves">
                  <label *ngFor="let m of entry.markers">
                    <input
                      type="checkbox"
                      [checked]="m.visible !== false"
                      (click)="toggleVisible(m)"
                    />
                    {{ m.name || "Marker" }}
                  </label>
                  <label *ngFor="let p of entry.polygons">
                    <input
                      type="checkbox"
                      [checked]="p.visible !== false"
                      (click)="toggleVisible(p)"
                    />
                    {{ p.name || "Polygon" }}
                  </label>
                  <label *ngFor="let c of entry.circles">
                    <input
                      type="checkbox"
                      [checked]="c.visible !== false"
                      (click)="toggleVisible(c)"
                    />
                    {{ c.name || "Circle" }}
                  </label>
                  <label *ngFor="let l of entry.lines; let i = index">
                    <input
                      type="checkbox"
                      [checked]="l.visible !== false"
                      (click)="toggleVisible(l)"
                    />
                    Line {{ i + 1 }}
                  </label>
                </div>
              </details>
            </details>
          </div>
      </div>

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
      >
      </ejs-maps>
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
  @ViewChild("mapInstance") mapInstance: MapsComponent;

  mapOptions: MapOptions;
  layerPanelOpen = false;
  layerTree: LayerTreeNode[] = [];

  // Fallback position before the real toolbar rect is measured (or if it
  // can't be found at all) — overwritten by alignLayerControl() below.
  layerBtnTop = 8;
  layerBtnRight = 90;
  panelTop = 50;
  panelMaxHeight = 500;

  // pdo-map-config.json now holds two entries: "omanv1" (base layer) and
  // "alwusta" (rendered as a SubLayer). Add further entries directly to
  // that JSON for more regions — the builder and this panel both already
  // handle an arbitrary-length array, no component changes needed.
  private configs: MapConfig[] = (pdoMapConfig as any).default ?? pdoMapConfig;

  constructor(private builder: NXMapBuilderService, private elRef: ElementRef<HTMLElement>) {}

  ngOnInit(): void {
    // Swap SHAPE_DATA_BY_LAYER_NAME's static lookup for
    // NXMapDataService.getMapInfo(...) per layerName (e.g. forkJoin over
    // all configs' layerNames) when wiring this back into the host app.
    const shapeDataByLayer = Object.fromEntries(
      this.configs.map(cfg => [cfg.layerName, SHAPE_DATA_BY_LAYER_NAME[cfg.layerName]])
    );

    this.mapOptions = this.builder.buildMap(this.configs, shapeDataByLayer);
    this.layerTree = this.builder.getLayerTree();
  }

  // Hides/shows the whole layer (shape + everything in it). The main layer
  // is excluded — every other layer's groups/markers render relative to
  // it, so turning it off would leave the map with nothing at all. The
  // checkbox is already [disabled] for it; this guard covers the case
  // where [disabled] doesn't stop the click event itself from firing.
  //
  // Writes through this.layerTree[layer.layerIndex] rather than mutating
  // the passed `layer` object directly — keeps this correct even if a
  // future change (e.g. a search/filter view) hands the template a
  // filtered copy of the tree instead of the original array's objects.
  toggleLayer(layer: LayerTreeNode): void {
    const original = this.layerTree[layer.layerIndex];
    if (original.isMainLayer) {
      return;
    }
    original.visible = !original.visible;
    this.builder.setLayerVisible(original.layerIndex, original.visible);
    this.builder.refresh(this.mapOptions);
    this.render();
  }

  // Shared by groups AND individual markers/polygons/circles/lines — all of
  // them are BaseMapObject-derived and share the same `visible?: boolean`
  // field. getLayerTree() hands out live references, so mutating `.visible`
  // here is exactly what buildMarkerPoints/buildNavigationLines/buildPolygon
  // check on the next refresh().
  toggleVisible(item: { visible?: boolean }): void {
    item.visible = !(item.visible !== false);
    this.builder.refresh(this.mapOptions);
    this.render();
  }

  onMarkerClick(args: IMarkerClickEventArgs): void {
    const graphic = this.builder.resolveMarkerClick(args as any);
    if (!graphic) {
      return;
    }
    console.log(`You selected ${graphic.groupName}`, graphic);
  }

  onMapClick(args: any): void {
    const graphic = this.builder.resolveClickedGraphic(args.target);
    if (!graphic) {
      return;
    }
    console.log(`You selected ${graphic.groupName}`, graphic);
  }

  private render(): void {
    if (this.mapInstance) {
      setTimeout(() => {
        this.mapInstance.refresh();
        // Lines are redrawn (new <path> elements) on every refresh — the
        // draw-in animation needs re-applying each time, not just on the
        // very first load.
        setTimeout(() => this.animateNavigationLines(), 100);
      }, 200);
    }
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
