import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild
} from "@angular/core";
import * as moment from "moment";
import { forkJoin, of, Subscription } from "rxjs";
import { catchError, map } from "rxjs/operators";
import {
  ImageMapConfig,
  ImageMapDataRecord,
  ImageMapLabelPosition,
  ImageMapLayerFile,
  ImageMapMarkerClickEvent,
  ImageMapMarkerShape,
  ImageMapParams,
  ImageMapTooltipEntry,
  ImageMapValueDisplay
} from "./model/nx-image-map-model";
import { NxImageMapConfigService, toQueryParams } from "./services/nx-image-map-config.service";
import { slugifyImageMapName } from "./services/image-map-parent-config-transform";

const DEFAULT_MARKER = { shape: "Circle" as ImageMapMarkerShape, color: "#47a1f6", width: 12, height: 12, borderColor: "#ffffff", borderWidth: 2 };
const DEFAULT_ZOOM_THRESHOLD_PX = 1200;
const DEFAULT_MAX_ZOOM = 8;
const DEFAULT_ZOOM_STEP = 1.5;
const DEFAULT_TOOLTIP_COLUMNS = 2;
const DEFAULT_AUTO_FIT_MAX_STRETCH = 0.15;
const DEFAULT_DATE_FORMAT = "dd-MMM-yyyy HH:mm";
const NO_DATA_PREFIX = "No data for";
// A pointer that moves less than this between down and up is a click
// (location pick / marker click), anything further is a pan drag.
const DRAG_THRESHOLD_PX = 4;

// One point from a layer file with its style fully resolved (point ->
// group style -> config.markerStyle -> DEFAULT_MARKER) and its data joined.
interface ResolvedMarker {
  key: string;
  id: string;
  name: string;
  layerName: string;
  groupId: string;
  groupName: string;
  x: number;
  y: number;
  shape: ImageMapMarkerShape;
  color: string;
  width: number;
  height: number;
  borderColor: string;
  borderWidth: number;
  imageUrl?: string;
  labelColor?: string;
  valueDisplay: ImageMapValueDisplay;
  labelPosition: ImageMapLabelPosition;
  records: ImageMapDataRecord[];
  // Tooltip tiles — the records' Tooltip.ComponentList entries when any
  // were sent, otherwise one tile per record (Label/Value/Unit/Color/Date).
  tiles: ImageMapTooltipEntry[];
  tooltipColumns: number;
  // Per-marker tile style (a record's Tooltip.Template), else TooltipFormat.Layout.
  tooltipLayout?: string;
}

interface PickedPoint {
  id: string;
  x: number;
  y: number;
}

interface LoadedLayer {
  source: string;
  file?: ImageMapLayerFile;
  error?: string;
}

// Layer filter tree: Layer -> Group -> Marker. Checked state lives only on
// the markers (checkedKeys); a group's/layer's state is derived from them.
interface FilterMarkerNode {
  key: string;
  name: string;
}
interface FilterGroupNode {
  key: string;
  name: string;
  markers: FilterMarkerNode[];
}
interface FilterLayerNode {
  key: string;
  name: string;
  groups: FilterGroupNode[];
}
type CheckState = "all" | "none" | "some";

function markerKey(layerName: string, groupId: string, pointId: string): string {
  return `${layerName}::${groupId}::${pointId}`;
}

// Picture-as-base-layer marker map. Rendering model:
//  - The <img> is drawn at its coordinate-space size (baseImage.width/height,
//    or its natural size) and placed with ONE CSS transform:
//    translate(tx, ty) scale(scaleX, scaleY), where scaleX/Y = fitScaleX/Y
//    * zoom. The fit scales come from config.imageFit — "fill" stretches to
//    exactly the viewport's width AND height (no side gaps, the two axes
//    scale independently), "contain" keeps the aspect ratio with gaps,
//    "cover" keeps it and crops the overflow, "auto" (default) picks fill or
//    contain by how much filling would distort (resolvedImageFit()).
//  - Markers/labels/pick pins live in an untransformed overlay, each at
//    screen position (tx + x * scaleX, ty + y * scaleY) — so they stay pinned
//    to their image spot at any size/zoom while keeping a constant on-screen
//    size (a 12px marker stays 12px at 8x zoom).
//  - The location picker inverts the same formula: x = (px - tx) / scaleX.
@Component({
  selector: "app-nx-image-map",
  templateUrl: "./nx-image-map.component.html",
  styleUrls: ["./nx-image-map.component.scss"]
})
export class NxImageMapComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() config?: ImageMapConfig;
  // The host page's current selection (date, asset, ...). Every change
  // refetches config.dataApiUrl with these as query params; with none set,
  // the default (param-less) call happens only when loadDataOnStart is true.
  @Input() params?: ImageMapParams | null;
  // Readings pushed directly by the host — when bound, wins over the
  // DataAPIURL fetch entirely.
  @Input() data?: ImageMapDataRecord[] | null;

  @Output() markerClick = new EventEmitter<ImageMapMarkerClickEvent>();

  @ViewChild("viewport", { static: true }) viewportRef!: ElementRef<HTMLDivElement>;

  // Every marker from every loaded layer, checked or not — visibleMarkers
  // (the filter's checked ones) is what renders.
  markers: ResolvedMarker[] = [];
  visibleMarkers: ResolvedMarker[] = [];
  problems: string[] = [];
  showProblems = false;
  loading = false;
  dataLoading = false;

  // Coordinate space every x/y is authored in.
  imageWidth = 0;
  imageHeight = 0;
  // The file's real resolution — what the "auto" zoom rule looks at.
  naturalWidth = 0;
  naturalHeight = 0;
  imageLoaded = false;
  imageError = false;

  viewportWidth = 0;
  viewportHeight = 0;
  fitScaleX = 1;
  fitScaleY = 1;
  zoom = 1;
  tx = 0;
  ty = 0;

  zoomEnabled = false;
  zoomDisabledReason = "";

  pickMode = false;
  picks: PickedPoint[] = [];
  cursor: { x: number; y: number } | null = null;
  toast = "";

  hovered: ResolvedMarker | null = null;

  // Layer filter popup.
  showFilter = false;
  filterText = "";
  filterTree: FilterLayerNode[] = [];
  private checkedKeys = new Set<string>();
  private expandedKeys = new Set<string>();

  private layers: LoadedLayer[] = [];
  private fetchedData: ImageMapDataRecord[] | null = null;
  private dataProblem = "";
  // Last params actually fetched with (normalized) — a host re-binding an
  // equal-but-new params object doesn't trigger a redundant call.
  private lastParamsKey: string | null = null;
  private pickCounter = 0;
  private lastImageUrl?: string;
  // A pan drag that ends over a marker still fires that marker's click —
  // swallowed so a drag never counts as a marker click.
  private suppressClick = false;
  private configSub?: Subscription;
  private dataSub?: Subscription;
  private resizeObserver?: ResizeObserver;
  private pointerDown: { x: number; y: number; tx: number; ty: number; id: number } | null = null;
  private dragging = false;
  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor(private configService: NxImageMapConfigService, private zone: NgZone) {}

  get scaleX(): number {
    return this.fitScaleX * this.zoom;
  }

  get scaleY(): number {
    return this.fitScaleY * this.zoom;
  }

  get imageTransform(): string {
    return `translate(${this.tx}px, ${this.ty}px) scale(${this.scaleX}, ${this.scaleY})`;
  }

  get locationPickerVisible(): boolean {
    return this.config?.showLocationPicker !== false;
  }

  get maxZoom(): number {
    return Math.max(1, this.config?.zoom?.maxZoom ?? DEFAULT_MAX_ZOOM);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.config) {
      this.loadConfig();
      this.refreshData(true);
      return;
    }
    if (changes.params) {
      this.refreshData(false);
    }
    if (changes.data) {
      this.buildMarkers();
    }
  }

  ngAfterViewInit(): void {
    const el = this.viewportRef.nativeElement;
    this.resizeObserver = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      this.zone.run(() => this.onViewportResize(rect.width, rect.height));
    });
    this.resizeObserver.observe(el);
    // Measured directly too — ResizeObserver callbacks are throttled/deferred
    // in a background tab, and the fit shouldn't wait on them. Deferred a
    // microtask so it doesn't change bound state mid change-detection.
    Promise.resolve().then(() => this.measureViewport());
    // Registered by hand rather than a (wheel) template binding so it is
    // explicitly non-passive — preventDefault() must be able to stop the
    // page from scrolling while the wheel is zooming the image.
    this.zone.runOutsideAngular(() => el.addEventListener("wheel", this.onWheel, { passive: false }));
  }

  ngOnDestroy(): void {
    this.configSub?.unsubscribe();
    this.dataSub?.unsubscribe();
    this.resizeObserver?.disconnect();
    this.viewportRef.nativeElement.removeEventListener("wheel", this.onWheel);
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
  }

  // ---------------------------------------------------------------- loading

  private loadConfig(): void {
    this.configSub?.unsubscribe();
    this.layers = [];
    this.markers = [];
    this.visibleMarkers = [];
    this.filterTree = [];
    this.checkedKeys = new Set();
    this.expandedKeys = new Set();
    this.zoom = 1;
    // Same picture as before -> the <img> won't fire (load) again, so
    // re-derive size/zoom rules from what it already reported.
    const sameImage = !!this.config?.baseImage?.url && this.config.baseImage.url === this.lastImageUrl && this.imageLoaded;
    this.lastImageUrl = this.config?.baseImage?.url;
    if (sameImage) {
      this.imageWidth = this.config?.baseImage?.width || this.naturalWidth;
      this.imageHeight = this.config?.baseImage?.height || this.naturalHeight;
      this.updateZoomEnabled();
      this.resetView();
    } else {
      this.imageLoaded = false;
      this.imageError = false;
      this.naturalWidth = this.naturalHeight = 0;
      this.imageWidth = this.config?.baseImage?.width ?? 0;
      this.imageHeight = this.config?.baseImage?.height ?? 0;
    }
    this.picks = [];
    this.pickCounter = 0;
    this.hovered = null;
    const config = this.config;
    if (!config) {
      this.buildMarkers();
      return;
    }

    this.loading = true;
    const layer$ = (config.layers ?? []).map(source =>
      this.configService.resolve<ImageMapLayerFile | ImageMapLayerFile[]>(source).pipe(
        // An API/inline source can bring several layer files at once.
        map(result =>
          (Array.isArray(result) ? result : [result]).map(file => ({ source: this.configService.describe(source), file } as LoadedLayer))
        ),
        catchError(err => of([{ source: this.configService.describe(source), error: err?.message ?? String(err) } as LoadedLayer]))
      )
    );
    this.configSub = (layer$.length ? forkJoin(layer$) : of([] as LoadedLayer[][])).subscribe(groups => {
      this.layers = ([] as LoadedLayer[]).concat(...groups);
      this.loading = false;
      this.buildMarkers();
      this.initFilter();
    });
  }

  // Fetches config.dataApiUrl for the current params. `configChanged` forces
  // a fetch even when params are unchanged (a new config is a fresh start).
  private refreshData(configChanged: boolean): void {
    const config = this.config;
    const query = toQueryParams(this.params);
    const key = JSON.stringify(Object.keys(query).sort().map(k => [k, query[k]]));
    if (!configChanged && key === this.lastParamsKey) {
      return;
    }
    this.lastParamsKey = key;
    this.dataSub?.unsubscribe();
    this.dataProblem = "";
    const hasParams = Object.keys(query).length > 0;
    if (!config?.dataApiUrl || (!hasParams && !config.loadDataOnStart)) {
      // Nothing to ask for yet — no params, and no start-up load configured.
      this.fetchedData = null;
      this.dataLoading = false;
      this.buildMarkers();
      return;
    }
    const url = config.dataApiUrl;
    this.dataLoading = true;
    this.dataSub = this.configService
      .loadData(url, this.params)
      .pipe(
        catchError(err => {
          this.dataProblem = `Data could not be loaded from "${url}": ${err?.message ?? err}`;
          return of([] as ImageMapDataRecord[]);
        })
      )
      .subscribe(records => {
        this.fetchedData = Array.isArray(records) ? records : [];
        this.dataLoading = false;
        this.buildMarkers();
      });
  }

  onImageLoad(img: HTMLImageElement): void {
    this.naturalWidth = img.naturalWidth;
    this.naturalHeight = img.naturalHeight;
    if (!this.config?.baseImage?.width || !this.config?.baseImage?.height) {
      this.imageWidth = img.naturalWidth;
      this.imageHeight = img.naturalHeight;
    }
    this.imageLoaded = true;
    this.imageError = false;
    this.measureViewport();
    this.updateZoomEnabled();
    this.resetView();
    this.buildMarkers();
  }

  onImageError(): void {
    this.imageError = true;
    this.imageLoaded = false;
    this.buildMarkers();
  }

  // Resolve every layer's points into ResolvedMarkers, join data by MarkerId
  // and collect anything that didn't line up into `problems`.
  private buildMarkers(): void {
    const config = this.config;
    const problems: string[] = [...(config?.configProblems ?? [])];
    const markers: ResolvedMarker[] = [];
    if (!config) {
      this.markers = markers;
      this.problems = problems;
      this.applyVisibility();
      return;
    }

    if (this.imageError) {
      problems.push(`Base image could not be loaded from "${config.baseImage?.url}".`);
    }
    if (this.imageLoaded && config.baseImage?.width && config.baseImage?.height) {
      const declared = config.baseImage.width / config.baseImage.height;
      const actual = this.naturalWidth / this.naturalHeight;
      if (Math.abs(declared - actual) / actual > 0.01) {
        problems.push(
          `baseImage is declared ${config.baseImage.width}×${config.baseImage.height} but the image file is ` +
            `${this.naturalWidth}×${this.naturalHeight} — a different aspect ratio, so the picture is stretched and points may not line up.`
        );
      }
    }

    const cfgStyle = config.markerStyle ?? {};
    const seen = new Map<string, string>();
    for (const layer of this.layers) {
      if (layer.error || !layer.file?.layerConfig) {
        problems.push(`Layer "${layer.source}" could not be loaded${layer.error ? `: ${layer.error}` : " (no layerConfig)"}.`);
        continue;
      }
      const lc = layer.file.layerConfig;
      for (const group of lc.groups ?? []) {
        const gs = group.markerConfig?.style ?? {};
        for (const p of group.markerConfig?.points ?? []) {
          const where = `layer "${lc.layerName}", group "${group.id}"`;
          if (!p.id) {
            problems.push(`A point in ${where} has no id and was skipped.`);
            continue;
          }
          const x = Number(p.x);
          const y = Number(p.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            problems.push(`Point "${p.id}" in ${where} has no valid x/y and was skipped.`);
            continue;
          }
          if (seen.has(p.id)) {
            problems.push(`Point id "${p.id}" is used more than once (${seen.get(p.id)} and ${where}) — data for it lands on both.`);
          } else {
            seen.set(p.id, where);
          }
          if (this.imageWidth && this.imageHeight && (x < 0 || y < 0 || x > this.imageWidth || y > this.imageHeight)) {
            problems.push(`Point "${p.id}" (${x}, ${y}) is outside the ${this.imageWidth}×${this.imageHeight} image.`);
          }
          const border = p.border ?? gs.border ?? cfgStyle.border ?? {};
          markers.push({
            key: markerKey(lc.layerName, group.id, p.id),
            id: p.id,
            name: p.name ?? p.id,
            layerName: lc.layerName,
            groupId: group.id,
            groupName: group.name ?? group.id,
            x,
            y,
            shape: p.shape ?? gs.shape ?? cfgStyle.shape ?? DEFAULT_MARKER.shape,
            color: p.color || gs.color || cfgStyle.color || DEFAULT_MARKER.color,
            width: p.width ?? gs.width ?? cfgStyle.width ?? DEFAULT_MARKER.width,
            height: p.height ?? gs.height ?? cfgStyle.height ?? DEFAULT_MARKER.height,
            borderColor: border.color ?? DEFAULT_MARKER.borderColor,
            borderWidth: border.width ?? DEFAULT_MARKER.borderWidth,
            imageUrl: p.imageUrl ?? gs.imageUrl ?? cfgStyle.imageUrl,
            labelColor: p.labelStyle?.color ?? gs.labelStyle?.color ?? cfgStyle.labelStyle?.color,
            valueDisplay: p.valueDisplay ?? group.valueDisplay ?? lc.valueDisplay ?? config.valueDisplay ?? "hover",
            labelPosition: p.labelPosition ?? group.labelPosition ?? config.labelPosition ?? "right",
            records: [],
            tiles: [],
            tooltipColumns: config.tooltip?.columns ?? DEFAULT_TOOLTIP_COLUMNS,
            tooltipLayout: config.tooltip?.layout
          });
        }
      }
    }

    if (config.defaultSelectedLayerNames && this.layers.length) {
      const known = new Set(markers.map(m => slugifyImageMapName(m.layerName)));
      const unknown = config.defaultSelectedLayerNames.filter(n => !known.has(slugifyImageMapName(n)));
      if (unknown.length) {
        problems.push(`LayersDefaultSelected names no loaded layer: ${unknown.join(", ")}.`);
      }
    }

    // Data join — MarkerId (scoped to LayerId's layer when given) -> markers.
    const records = this.data ?? this.fetchedData;
    if (this.dataProblem && !this.data) {
      problems.push(this.dataProblem);
    }
    if (records && this.layers.length) {
      const byId = new Map<string, ResolvedMarker[]>();
      markers.forEach(m => byId.set(m.id, [...(byId.get(m.id) ?? []), m]));
      const unmatched = new Set<string>();
      for (const rec of records) {
        const id = rec.MarkerId ?? rec.markerId;
        const layerSlug = rec.LayerId ? slugifyImageMapName(rec.LayerId) : null;
        const targets = (id ? byId.get(id) ?? [] : []).filter(m => !layerSlug || slugifyImageMapName(m.layerName) === layerSlug);
        if (!targets.length) {
          unmatched.add(rec.LayerId ? `${rec.LayerId}/${id ?? "(no MarkerId)"}` : id ?? "(no MarkerId)");
          continue;
        }
        for (const m of targets) {
          m.records.push(rec);
          if (rec.Tooltip?.Columns) {
            m.tooltipColumns = rec.Tooltip.Columns;
          }
          if (rec.Tooltip?.Template) {
            m.tooltipLayout = rec.Tooltip.Template;
          }
          if (m.records.length === 1 && rec.Color) {
            m.color = rec.Color;
          }
        }
      }
      for (const m of markers) {
        const components = ([] as ImageMapTooltipEntry[]).concat(...m.records.map(r => r.Tooltip?.ComponentList ?? []));
        m.tiles = components.length
          ? components
          : m.records.map(r => ({ Label: r.Label ?? "Value", Value: r.Value, Unit: r.Unit, Color: r.Color, Date: r.Date }));
      }
      if (unmatched.size) {
        problems.push(`Data for ${unmatched.size} marker id(s) has no matching point: ${[...unmatched].join(", ")}.`);
      }
    }

    this.markers = markers;
    this.problems = problems;
    this.applyVisibility();
  }

  // Recomputes what renders from the filter's checked markers, plus the
  // "no data" warning (only for markers actually shown).
  private applyVisibility(): void {
    this.visibleMarkers = this.markers.filter(m => this.checkedKeys.has(m.key));
    if (this.hovered && !this.checkedKeys.has(this.hovered.key)) {
      this.hovered = null;
    }
    const problems = this.problems.filter(p => !p.startsWith(NO_DATA_PREFIX));
    if (this.data ?? this.fetchedData) {
      const noData = this.visibleMarkers.filter(m => !m.records.length).map(m => m.id);
      if (noData.length) {
        problems.push(`${NO_DATA_PREFIX} ${noData.length} shown point(s): ${noData.join(", ")}.`);
      }
    }
    this.problems = problems;
    if (!problems.length) {
      this.showProblems = false;
    }
  }

  // ------------------------------------------------------------ layer filter

  // Builds the Layer -> Group -> Marker tree once the layers load and sets
  // the starting checks: LayersDefaultSelected layers only (every layer when
  // unset), minus any group whose own `visible` is false.
  private initFilter(): void {
    const selected = this.config?.defaultSelectedLayerNames
      ? new Set(this.config.defaultSelectedLayerNames.map(slugifyImageMapName))
      : null;
    const tree: FilterLayerNode[] = [];
    this.checkedKeys = new Set();
    for (const layer of this.layers) {
      const lc = layer.file?.layerConfig;
      if (!lc) {
        continue;
      }
      const layerOn = !selected || selected.has(slugifyImageMapName(lc.layerName));
      const layerNode: FilterLayerNode = { key: `L::${lc.layerName}`, name: lc.layerName, groups: [] };
      for (const group of lc.groups ?? []) {
        const groupNode: FilterGroupNode = { key: `G::${lc.layerName}::${group.id}`, name: group.name ?? group.id, markers: [] };
        for (const m of this.markers.filter(x => x.layerName === lc.layerName && x.groupId === group.id)) {
          groupNode.markers.push({ key: m.key, name: m.name });
          if (layerOn && group.visible !== false) {
            this.checkedKeys.add(m.key);
          }
        }
        if (groupNode.markers.length) {
          layerNode.groups.push(groupNode);
        }
      }
      if (layerNode.groups.length) {
        tree.push(layerNode);
        this.expandedKeys.add(layerNode.key);
      }
    }
    this.filterTree = tree;
    this.applyVisibility();
  }

  toggleFilter(): void {
    this.showFilter = !this.showFilter;
  }

  layerState(l: FilterLayerNode): CheckState {
    return this.stateOf(([] as FilterMarkerNode[]).concat(...l.groups.map(g => g.markers)));
  }

  groupState(g: FilterGroupNode): CheckState {
    return this.stateOf(g.markers);
  }

  isChecked(m: FilterMarkerNode): boolean {
    return this.checkedKeys.has(m.key);
  }

  private stateOf(nodes: FilterMarkerNode[]): CheckState {
    const on = nodes.filter(n => this.checkedKeys.has(n.key)).length;
    return on === 0 ? "none" : on === nodes.length ? "all" : "some";
  }

  // A partly-checked parent checks everything under it on click, same as
  // nx-map's filter tree.
  toggleLayer(l: FilterLayerNode): void {
    const on = this.layerState(l) !== "all";
    l.groups.forEach(g => this.setChecked(g.markers, on));
    this.applyVisibility();
  }

  toggleGroup(g: FilterGroupNode): void {
    this.setChecked(g.markers, this.groupState(g) !== "all");
    this.applyVisibility();
  }

  toggleMarker(m: FilterMarkerNode): void {
    this.setChecked([m], !this.checkedKeys.has(m.key));
    this.applyVisibility();
  }

  setAll(on: boolean): void {
    this.filterTree.forEach(l => l.groups.forEach(g => this.setChecked(g.markers, on)));
    this.applyVisibility();
  }

  private setChecked(nodes: FilterMarkerNode[], on: boolean): void {
    nodes.forEach(n => (on ? this.checkedKeys.add(n.key) : this.checkedKeys.delete(n.key)));
  }

  // While searching everything is expanded, so matches are never hidden
  // under a collapsed row.
  isExpanded(key: string): boolean {
    return !!this.filterText.trim() || this.expandedKeys.has(key);
  }

  toggleExpanded(key: string): void {
    if (this.expandedKeys.has(key)) {
      this.expandedKeys.delete(key);
    } else {
      this.expandedKeys.add(key);
    }
  }

  // Search keeps a match's whole ancestor chain: a matching layer shows
  // everything under it, a matching group shows all its markers, a matching
  // marker shows just itself (plus its group/layer rows).
  private matches(name: string): boolean {
    const q = this.filterText.trim().toLowerCase();
    return !q || name.toLowerCase().includes(q);
  }

  shownGroups(l: FilterLayerNode): FilterGroupNode[] {
    if (this.matches(l.name)) {
      return l.groups;
    }
    return l.groups.filter(g => this.matches(g.name) || g.markers.some(m => this.matches(m.name)));
  }

  shownMarkers(l: FilterLayerNode, g: FilterGroupNode): FilterMarkerNode[] {
    if (this.matches(l.name) || this.matches(g.name)) {
      return g.markers;
    }
    return g.markers.filter(m => this.matches(m.name));
  }

  get shownLayers(): FilterLayerNode[] {
    return this.filterTree.filter(l => this.shownGroups(l).length);
  }

  // ---------------------------------------------------------------- tooltip

  tooltipLayoutClass(m: ResolvedMarker): string {
    return `nim-tooltip--layout-${(m.tooltipLayout || "default").toLowerCase()}`;
  }

  // Reading timestamps in TooltipFormat.DateFormat — same token set and the
  // same moment.parseZone() rule nx-map uses (shows the reading's own
  // wall-clock time as sent, not converted to the viewer's zone).
  formatDate(raw: string | undefined): string {
    const parsed = raw ? moment.parseZone(raw) : null;
    if (!parsed?.isValid()) {
      return raw ?? "";
    }
    const tokens = (this.config?.tooltip?.dateFormat || DEFAULT_DATE_FORMAT).match(/yyyy|MMM|MM|dd|HH|hh|mm|ss|a|[^A-Za-z]+|[A-Za-z]/g) ?? [];
    return parsed.format(tokens.map(t => (t === "yyyy" ? "YYYY" : t === "dd" ? "DD" : t)).join(""));
  }

  hasLimit(t: ImageMapTooltipEntry): boolean {
    return t.Limit !== undefined && t.Limit !== null && t.Limit !== "";
  }

  // ------------------------------------------------------------- zoom / pan

  private updateZoomEnabled(): void {
    const z = this.config?.zoom ?? {};
    const mode = z.mode ?? "auto";
    const threshold = z.autoThresholdPx ?? DEFAULT_ZOOM_THRESHOLD_PX;
    if (mode === "on") {
      this.zoomEnabled = true;
      this.zoomDisabledReason = "";
    } else if (mode === "off") {
      this.zoomEnabled = false;
      this.zoomDisabledReason = "Zoom is turned off for this image.";
    } else {
      this.zoomEnabled = Math.max(this.naturalWidth, this.naturalHeight) > threshold;
      this.zoomDisabledReason = this.zoomEnabled
        ? ""
        : `Zoom disabled — the image is ${this.naturalWidth}×${this.naturalHeight}px, below the ${threshold}px auto-zoom threshold.`;
    }
    if (!this.zoomEnabled) {
      this.zoom = 1;
    }
  }

  private measureViewport(): void {
    const el = this.viewportRef.nativeElement;
    this.onViewportResize(el.clientWidth, el.clientHeight);
  }

  private onViewportResize(width: number, height: number): void {
    if (width === this.viewportWidth && height === this.viewportHeight) {
      return;
    }
    // Keep whatever image point sits at the view's center there after resize.
    const hadSize = this.viewportWidth > 0 && this.imageWidth > 0;
    const cx = hadSize ? (this.viewportWidth / 2 - this.tx) / this.scaleX : this.imageWidth / 2;
    const cy = hadSize ? (this.viewportHeight / 2 - this.ty) / this.scaleY : this.imageHeight / 2;
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.updateFitScale();
    this.tx = width / 2 - cx * this.scaleX;
    this.ty = height / 2 - cy * this.scaleY;
    this.clampPan();
  }

  private updateFitScale(): void {
    if (!this.imageWidth || !this.imageHeight || !this.viewportWidth || !this.viewportHeight) {
      this.fitScaleX = this.fitScaleY = 1;
      return;
    }
    const sx = this.viewportWidth / this.imageWidth;
    const sy = this.viewportHeight / this.imageHeight;
    const fit = this.resolvedImageFit(sx, sy);
    if (fit === "fill") {
      this.fitScaleX = sx;
      this.fitScaleY = sy;
    } else {
      this.fitScaleX = this.fitScaleY = fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
    }
  }

  // "auto" (the default): fill the area edge to edge when that only stretches
  // the picture a little — its aspect ratio within autoFitMaxStretch (default
  // 15%) of the area's — otherwise keep its proportions ("contain") rather
  // than visibly distort it. Re-decided on every resize.
  private resolvedImageFit(sx: number, sy: number): "fill" | "contain" | "cover" {
    const fit = this.config?.imageFit ?? "auto";
    if (fit !== "auto") {
      return fit;
    }
    const maxStretch = this.config?.autoFitMaxStretch ?? DEFAULT_AUTO_FIT_MAX_STRETCH;
    const stretch = Math.max(sx, sy) / Math.min(sx, sy) - 1;
    return stretch <= maxStretch ? "fill" : "contain";
  }

  // A picture smaller than the view stays centered on that axis; a larger
  // one can pan but never leaves an empty gap at its edge.
  private clampPan(): void {
    const sw = this.imageWidth * this.scaleX;
    const sh = this.imageHeight * this.scaleY;
    this.tx = sw <= this.viewportWidth ? (this.viewportWidth - sw) / 2 : Math.min(0, Math.max(this.viewportWidth - sw, this.tx));
    this.ty = sh <= this.viewportHeight ? (this.viewportHeight - sh) / 2 : Math.min(0, Math.max(this.viewportHeight - sh, this.ty));
  }

  resetView(): void {
    this.zoom = 1;
    this.updateFitScale();
    // Centered — for "cover" the image overflows one axis, and clampPan()
    // alone would otherwise pin it to that axis's top/left edge.
    this.tx = (this.viewportWidth - this.imageWidth * this.scaleX) / 2;
    this.ty = (this.viewportHeight - this.imageHeight * this.scaleY) / 2;
    this.clampPan();
  }

  zoomIn(): void {
    this.zoomBy(this.config?.zoom?.step ?? DEFAULT_ZOOM_STEP);
  }

  zoomOut(): void {
    this.zoomBy(1 / (this.config?.zoom?.step ?? DEFAULT_ZOOM_STEP));
  }

  // Zoom about (cx, cy) in viewport px — that image point stays under it.
  private zoomBy(factor: number, cx = this.viewportWidth / 2, cy = this.viewportHeight / 2): void {
    if (!this.zoomEnabled) {
      return;
    }
    const next = Math.min(this.maxZoom, Math.max(1, this.zoom * factor));
    if (next === this.zoom) {
      return;
    }
    const ix = (cx - this.tx) / this.scaleX;
    const iy = (cy - this.ty) / this.scaleY;
    this.zoom = next;
    this.tx = cx - ix * this.scaleX;
    this.ty = cy - iy * this.scaleY;
    this.clampPan();
  }

  private onWheel = (e: WheelEvent): void => {
    // Scrolling inside a popup (Layers/Problems) scrolls the popup, not zoom.
    if (!this.zoomEnabled || !e.deltaY || (e.target as HTMLElement | null)?.closest?.(".nim-top-right")) {
      return;
    }
    e.preventDefault();
    const rect = this.viewportRef.nativeElement.getBoundingClientRect();
    const step = this.config?.zoom?.step ?? DEFAULT_ZOOM_STEP;
    this.zone.run(() => this.zoomBy(e.deltaY < 0 ? step : 1 / step, e.clientX - rect.left, e.clientY - rect.top));
  };

  onDoubleClick(e: MouseEvent): void {
    if (!this.zoomEnabled || this.pickMode) {
      return;
    }
    const rect = this.viewportRef.nativeElement.getBoundingClientRect();
    this.zoomBy(this.config?.zoom?.step ?? DEFAULT_ZOOM_STEP, e.clientX - rect.left, e.clientY - rect.top);
  }

  onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) {
      return;
    }
    this.pointerDown = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty, id: e.pointerId };
    this.dragging = false;
    this.suppressClick = false;
  }

  onPointerMove(e: PointerEvent): void {
    if (this.pickMode) {
      this.cursor = this.toImagePoint(e);
    }
    const down = this.pointerDown;
    if (!down || down.id !== e.pointerId) {
      return;
    }
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (!this.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
      return;
    }
    if (!this.zoomEnabled) {
      return;
    }
    if (!this.dragging) {
      this.dragging = true;
      this.hovered = null;
      this.viewportRef.nativeElement.setPointerCapture(e.pointerId);
    }
    this.tx = down.tx + dx;
    this.ty = down.ty + dy;
    this.clampPan();
  }

  onPointerUp(e: PointerEvent): void {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || down.id !== e.pointerId) {
      return;
    }
    if (this.dragging) {
      this.dragging = false;
      this.suppressClick = true;
      this.viewportRef.nativeElement.releasePointerCapture(e.pointerId);
      return;
    }
    if (this.pickMode) {
      this.pick(e);
    }
  }

  onPointerLeave(): void {
    this.cursor = null;
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  // ---------------------------------------------------------------- markers

  screenX(x: number): number {
    return this.tx + x * this.scaleX;
  }

  screenY(y: number): number {
    return this.ty + y * this.scaleY;
  }

  showsTooltip(m: ResolvedMarker): boolean {
    return m.valueDisplay !== "always";
  }

  showsValueBox(m: ResolvedMarker): boolean {
    return m.valueDisplay !== "hover";
  }

  onMarkerEnter(m: ResolvedMarker): void {
    if (!this.dragging && this.showsTooltip(m)) {
      this.hovered = m;
    }
  }

  onMarkerLeave(m: ResolvedMarker): void {
    if (this.hovered === m) {
      this.hovered = null;
    }
  }

  onMarkerClick(m: ResolvedMarker, e: MouseEvent): void {
    if (this.pickMode || this.suppressClick) {
      return; // a pick-mode click is a location pick, not a marker click
    }
    e.stopPropagation();
    this.markerClick.emit({ id: m.id, name: m.name, layerName: m.layerName, groupId: m.groupId, x: m.x, y: m.y, records: m.records });
  }

  // Tooltip flips to whichever side of the marker has more room.
  tooltipTransform(m: ResolvedMarker): string {
    const right = this.screenX(m.x) > this.viewportWidth / 2;
    const below = this.screenY(m.y) > this.viewportHeight / 2;
    const ox = right ? "calc(-100% - 14px)" : "14px";
    const oy = below ? "calc(-100% - 14px)" : "14px";
    return `translate(${ox}, ${oy})`;
  }

  formatValue(value: string | number | undefined, unit?: string): string {
    if (value === undefined || value === null || value === "") {
      return "—";
    }
    const n = typeof value === "number" ? value : Number(value);
    const text = Number.isFinite(n) && typeof value === "number" ? String(+n.toFixed(3)) : String(value);
    return unit ? `${text} ${unit}` : text;
  }

  trackMarker(_: number, m: ResolvedMarker): string {
    return m.key;
  }

  // Shape outlines inside a (width + 2·border) × (height + 2·border) box.
  svgWidth(m: ResolvedMarker): number {
    return m.width + m.borderWidth * 2;
  }

  svgHeight(m: ResolvedMarker): number {
    return m.height + m.borderWidth * 2;
  }

  polygonPoints(m: ResolvedMarker): string {
    const b = m.borderWidth;
    const w = m.width;
    const h = m.height;
    if (m.shape === "Triangle") {
      return `${b + w / 2},${b} ${b + w},${b + h} ${b},${b + h}`;
    }
    return `${b + w / 2},${b} ${b + w},${b + h / 2} ${b + w / 2},${b + h} ${b},${b + h / 2}`;
  }

  balloonPath(m: ResolvedMarker): string {
    const b = m.borderWidth;
    const w = m.width;
    const h = m.height;
    const r = w / 2;
    const cx = b + r;
    const cy = b + r;
    return `M ${cx} ${b + h} C ${cx - r * 0.35} ${cy + r * 1.1}, ${b} ${cy + r * 0.6}, ${b} ${cy} A ${r} ${r} 0 1 1 ${b + w} ${cy} C ${b + w} ${cy + r * 0.6}, ${cx + r * 0.35} ${cy + r * 1.1}, ${cx} ${b + h} Z`;
  }

  // ------------------------------------------------------- location picker

  togglePickMode(): void {
    this.pickMode = !this.pickMode;
    this.hovered = null;
    if (!this.pickMode) {
      this.cursor = null;
    }
  }

  private toImagePoint(e: MouseEvent): { x: number; y: number } | null {
    const rect = this.viewportRef.nativeElement.getBoundingClientRect();
    const x = (e.clientX - rect.left - this.tx) / this.scaleX;
    const y = (e.clientY - rect.top - this.ty) / this.scaleY;
    if (x < 0 || y < 0 || x > this.imageWidth || y > this.imageHeight) {
      return null;
    }
    return { x: Math.round(x), y: Math.round(y) };
  }

  private pick(e: MouseEvent): void {
    const point = this.toImagePoint(e);
    if (!point) {
      this.showToast("That spot is outside the image.");
      return;
    }
    this.pickCounter++;
    this.picks = [{ id: `POINT-${this.pickCounter}`, ...point }, ...this.picks];
    // Straight to the clipboard on every click, same as nx-map's own
    // coordinate picker — in the exact form a layer file's point takes, so
    // it pastes directly after a point's "id".
    const label = `x ${point.x}, y ${point.y}`;
    this.copy(`"x": ${point.x}, "y": ${point.y}`, `${label} — copied to clipboard`, label);
  }

  pointSnippet(p: PickedPoint): string {
    return `{ "id": "${p.id}", "x": ${p.x}, "y": ${p.y}, "name": "" }`;
  }

  copyPick(p: PickedPoint): void {
    this.copy(this.pointSnippet(p), `Copied ${p.id}`);
  }

  copyAllPicks(): void {
    // Oldest first — the order they were clicked.
    const lines = [...this.picks].reverse().map(p => `  ${this.pointSnippet(p)}`);
    this.copy(`[\n${lines.join(",\n")}\n]`, `Copied ${this.picks.length} point(s)`);
  }

  removePick(p: PickedPoint): void {
    this.picks = this.picks.filter(x => x !== p);
  }

  clearPicks(): void {
    this.picks = [];
    this.pickCounter = 0;
  }

  // `failMessage` is shown when neither clipboard route works — the toast
  // still lands (e.g. just the coordinates) rather than the action looking
  // like it silently did nothing.
  private copy(text: string, message: string, failMessage = "Copy failed — select the text manually."): void {
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      document.body.removeChild(ta);
      this.showToast(ok ? message : failMessage);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => this.zone.run(() => this.showToast(message)),
        () => this.zone.run(fallback)
      );
    } else {
      fallback();
    }
  }

  private showToast(message: string): void {
    this.toast = message;
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
    this.toastTimer = setTimeout(() => (this.toast = ""), 2000);
  }
}
