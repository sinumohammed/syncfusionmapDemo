# NX Map Demo

Angular + Syncfusion Maps (`@syncfusion/ej2-angular-maps`) demo that renders one or more map **layers** from config, and a layer/group/item visibility panel driven by the same data.

## Structure

- `app/nx-map/model/nx-map-model.ts` — shared config/model interfaces (`MapConfig`, `MapGroup`, `MapPoint`, `MapLine`, `MapPolygon`, `MapCircle`, `MapOptions`, `DataSource<T>`, `MapTheme` + friends, ...).
- `app/nx-map/model/nx-map-app-config.ts` — `NXMapAppConfig`, `StaticLayerRef`, `SubLayerApiConfig`: the app-level "where does each piece of data come from" config.
- `app/nx-map/services/nx-map-config.service.ts` — resolves a `DataSource<T>` (inline/file/api) into data, resolves a layer's shapeData with the bundled registry as fallback, and fetches+normalizes sub-layer API groups.
- `app/nx-map/services/nx-map-builder.service.ts` — converts resolved `MapConfig[]` + per-layer GeoJSON shape data into Syncfusion's `LayerSettingsModel[]`. Owns per-layer state, theme resolution, marker/polygon click-resolution lookups, the id-based line-waypoint lookup, and the layer-tree used by the UI panel.
- `app/nx-map/nx-map-demo.component.ts` — demo component: resolves `NXMapAppConfig` into map data, renders `<ejs-maps>`, a custom layer-list panel (layer → group/heading → item checkboxes, plus a per-layer theme test `<select>`), and wires up map interactions.
- `app/nx-map/data/pdo-map-config.json` — an `NXMapAppConfig`: base layer, static layers, and sub-layer API config. This is the demo's normal/default config.
- `app/nx-map/data/nx-map-themes.json` — the theme registry (see "Themes" below), keyed by theme name. Bundled via a direct compile-time import (`resolveJsonModule`), not fetched.
- `app/nx-map/data/shape-data-registry.ts` — `SHAPE_DATA_BY_LAYER_NAME`, a compile-time-bundled fallback shapeData source keyed by `layerName` (see "Shape data fallback" below).
- `app/nx-map/data/parent-config-transform.ts` — `buildAppConfig()`, converting an arbitrary upstream "parent object" shape (`RawLayerNode`) into a valid `NXMapAppConfig` (see "Parent-object transform" below). `sample-parent-config.json`/`real-parent-config.json` are example inputs for it; `nx-map-demo.component.ts` can be pointed at either one in place of `pdo-map-config.json` for testing.
- `assets/nx-map/` — shape/boundary GeoJSON and static-layer `MapConfig` JSON, served as static HTTP assets (fetched via `HttpClient`) for layers that don't rely on the bundled shape-data registry.
- `assets/mock-api/` — stand-in JSON responses for the sub-layer API until a real backend exists: `sublayer-groups.json` (full response — Main Oil Line + Surface groups) and `sublayer-groups-partial.json` (Main Oil Line only, used to demo that a reload *replaces* rather than merges groups).

## `NXMapAppConfig` — where the data comes from

`pdo-map-config.json` isn't the map data itself — it's a description of where each piece comes from, so a deployment can swap sources without code changes:

```ts
interface NXMapAppConfig {
  baseLayerConfigSource: DataSource<MapConfig>; // the base layer's own groups (usually empty — see below); its `layerName` is the only source of truth for the base layer's name — no separate field for it
  shapeDataSource?: DataSource<any>;            // the base layer's boundary GeoJSON — same property name as StaticLayerRef.shapeDataSource below; omit to fall back to the bundled SHAPE_DATA_BY_LAYER_NAME registry (data/shape-data-registry.ts), keyed by the base layer's own layerName
  staticLayers: StaticLayerRef[];               // hardcoded layers, each with their own config + shape source
  subLayerApis: SubLayerApiConfig[];            // one or more endpoints returning MapGroup(s) at runtime, merged into the BASE layer's groups
  theme?: string;                               // app-wide default theme name (nx-map-themes.json) — every layer inherits this unless it sets its own, see "Themes" below
}

interface StaticLayerRef {
  configSource: DataSource<MapConfig>;     // same rule as baseLayerConfigSource — no separate layerName field; it's only known once this resolves
  shapeDataSource?: DataSource<any>;       // omit to fall back to the shape-data registry, keyed by this layer's own resolved layerName
  subLayerApis?: SubLayerApiConfig[];      // THIS layer's own sub-layer API(s) — merged into its own groups, not the base layer's
  theme?: string;                          // overrides whatever this layer's own resolved config sets
  parentLayerName?: string;                // default: the base layer's own layerName
  participateInFilter?: boolean;           // default true
}

interface DataSource<T> {
  source: "inline" | "file" | "api";
  value?: T;    // when source === "inline"
  url?: string; // when source === "file" | "api" — both resolved via HttpClient.get
}
```

- **Base layer** (its name is whatever `baseLayerConfigSource` resolves to, e.g. `"omanv1"` — not a separate config field) — the outer country/region shape. It's usually just the boundary with **no groups of its own** (`groups: []`); its job is to give every other layer/sub-layer something to render relative to. Its shape/boundary geometry (`shapeDataSource`) and its group/marker config (`baseLayerConfigSource`) are independent sources — either can be `"inline"`, `"file"`, or `"api"`.
- **Static layers** (`staticLayers: StaticLayerRef[]`) — hardcoded layers with their own real boundary/shapeData (genuinely separate Syncfusion `SubLayer`s, same mechanism as a governorate boundary). Each entry's `layerName` is likewise only known once `configSource` resolves — `nx-map-demo.component.ts`'s `ngOnInit()` resolves each ref's config first, then uses the resolved `layerName` for the shapeData-fallback lookup and for merging that ref's own `subLayerApis` groups.
- **Sub-layer API config** (`subLayerApis: SubLayerApiConfig[]`) — purely configuration, no data. Each entry is one endpoint URL plus an optional default `heading`. At the `NXMapAppConfig` level, the `MapGroup[]` content arrives at runtime from the API call(s) and is merged into the **base layer's** `groups[]`; at the `StaticLayerRef` level (per-layer `subLayerApis`), it's merged into **that layer's own** `groups[]` instead — sub-layer groups share whichever layer's geography they're merged into, so unlike static layers they don't get their own Syncfusion layer (see the "same geography → groups, not layers" guidance in `nx-map-builder.service.ts`).

`subLayerApis` currently points at `assets/mock-api/sublayer-groups.json` (and `sublayer-groups-partial.json`, used by the demo's "Reload Sub-Layers" test button) — static JSON served over real HTTP via `HttpClient.get`, exactly like a live endpoint. Swapping to a real backend later is a one-line config change (replace the `url`) — no other code changes needed.

## Themes

A layer's markers/clusters/lines/polygons/circles/tooltip-border/dataLabel can each supply their own style inline, or fall back to a named theme's defaults — `nx-map-themes.json` is a flat registry (`"default"`, `"theme1"`, `"theme2"`, ...) of `MapTheme` objects, imported at compile time (same pattern as `pdo-map-config.json`).

Resolution precedence, per style field, most specific wins:

1. The value set directly on the point/polygon/circle/line/group itself.
2. `MapGroup.theme` — a group's own theme override (matters most for sub-layer API groups, which merge into an existing layer rather than getting their own config — see "Sub-layer API config" above).
3. `MapConfig.theme` / `StaticLayerRef.theme` — that layer's own theme.
4. `NXMapAppConfig.theme` — the app-wide default, set once instead of repeating the same theme on every layer.
5. `"default"` — reproduces the values that used to be hardcoded directly in `nx-map-builder.service.ts` (marker border, polygon/circle fill/opacity/border, tooltip border), so a layer/group that sets nothing at any level renders exactly as before this system existed.

An unrecognized theme name at any level falls back to `"default"` rather than erroring. The layer panel includes a per-layer theme `<select>` (`onLayerThemeChange()` in `nx-map-demo.component.ts`) for trying different themes live without editing config — a test control, not meant to represent real end-user UI.

## Shape data fallback

`shapeDataSource`/`StaticLayerRef.shapeDataSource` are optional. When a layer's config doesn't supply one (or supplies a `"file"`/`"api"` source with no actual URL — some real upstream payloads report a source type without necessarily populating the URL), `NXMapConfigService.resolveShapeData()` falls back to `SHAPE_DATA_BY_LAYER_NAME` (`data/shape-data-registry.ts`), looked up by that layer's own resolved `layerName`. An explicit `shapeDataSource` always wins over the registry when present. A `layerName` found in neither logs a console warning and resolves to `undefined` — the layer still builds, just with no shape/boundary drawn.

## Id-based line waypoints

`MapLine.points` (a raw array of `{latitude, longitude}` waypoints) is still fully supported, but duplicates coordinates that may already exist on a named marker elsewhere in the same data. `MapLine.pointIds?: string[]` is the preferred alternative: an ordered list of marker ids (`MapPoint.id`, inherited from `BaseMapObject`), resolved by `NXMapBuilderService.buildPointIdLookup()`/`resolveLinePoints()` against every marker in that line's **layer** (not just its own group, so a line can connect markers living in different groups). `pointIds` takes precedence over `points` when both are set; an id with no matching marker logs a warning and that one waypoint is skipped rather than breaking the whole line. Both formats can coexist on different lines in the same file — see `assets/mock-api/sublayer-groups.json`'s Main Oil Line group (fully migrated to `pointIds`) alongside its Surface group's line (still raw `points`).

## Parent-object transform

Real host applications may hand this component a payload shaped nothing like `NXMapAppConfig` — e.g. one node per layer, each carrying `LayerConfigSource`/`LayerConfigJSON`/`LayerConfigURL`/`ShapeDataSource`/`ShapeDataJSON`/`ShapeDataURL`/`SubLayersAPI`/`Theme`/`Configuration` (a 0/1/2 inline/file/api enum for both the layer's own config and its shape data, a nested `Configuration[]` for static/child layers, one bare sub-layer-API URL, and an optional theme override), among many other unrelated fields. `parent-config-transform.ts`'s `buildAppConfig(root: RawLayerNode)` converts one such tree into a valid `NXMapAppConfig`, handling: the inline/file/api enum for both config and shape sources, treating a "file"/"api" shape source with no URL as "not supplied" (triggering the shape-data-registry fallback above), converting a bare `SubLayersAPI` URL into the `{url}[]` shape `subLayerApis` expects, and applying `Theme` as an override over whatever the resolved config itself sets. `sample-parent-config.json` is a small synthetic example of this shape; `real-parent-config.json` is an actual captured payload. Point `nx-map-demo.component.ts`'s `appConfig` field at `buildAppConfig(...)` over either one (in place of importing `pdo-map-config.json`) to test against real upstream data.

## Filter popup structure

Three toggle levels, plus two additions:

- **Layer** checkbox — hides the whole region (shape + everything in it). Disabled for the base/main layer. Also carries a theme `<select>` (test-only — see "Themes" above).
- **Heading** — a toggleable section bucketing groups that share the same `MapGroup.heading` (typically groups delivered by a sub-layer API call, tagged via `SubLayerApiConfig.heading`). Checking/unchecking it flips visibility for every group nested under it. Groups without a `heading` render directly under their layer.
- **Group** checkbox — hides that group's markers/lines/polygons/circles.
- **Item** checkbox — hides one specific marker/polygon/circle/line.
- **Nested layers** — a layer whose `MapConfig.parentLayerName` matches another loaded layer's `layerName` renders nested under that layer's node instead of as a top-level sibling (used for static layers under the base/Oman layer). A layer with `participateInFilter: false` renders on the map but has no node in the tree at all.

Unchecking every leaf/group under a layer does **not** hide that layer's own shape — only its own checkbox does. This is what lets a region's boundary be shown on its own with no markers/polygons/lines drawn. A group/layer with nothing to expand (e.g. a static layer configured with `groups: []`) renders as a plain row with no disclosure arrow, instead of an empty `<details>`.

`NXMapBuilderService.getLayerTree()` builds this whole structure (`LayerTreeNode.groups`/`.headings`/`.children`/`.themeName`) from the resolved `MapConfig[]`; the component template renders it via a self-referencing `ng-template` (`layerNodeTpl`) so nesting depth isn't hardcoded.

## Config-level features (`MapConfig`)

- `isMainLayer` — marks the base/primary layer (defaults to the first entry if none set). The main layer can't be hidden from the layer panel or via `setLayerVisible()`.
- `baseMapType: "shape" | "osm"` — renders a layer from `shapeData` (default) or OpenStreetMap tiles. **OSM is only honored on the main layer** — a SubLayer requesting OSM falls back to shape rendering with a console warning. Combining an OSM main layer with a marker-bearing SubLayer has also been observed to cause the two layers' markers to fight over visibility — prefer `"shape"` on the main layer when SubLayers have markers.
- `mapCenter` / `zoomFactor` — initial center/zoom, mainly needed when the main layer is `"osm"` (no shapeData bounding box to auto-fit against).
- `visible` (default `true`) — set to `false` to exclude a layer entirely at build time: it won't render on the map **and** won't appear in the layer panel's filter tree. Ignored (with a warning) on the main layer. Distinct from `participateInFilter` (map yes, filter no) and the runtime `setLayerVisible()` toggle (keeps a layer in the tree but hidden).
- `parentLayerName` / `participateInFilter` — see "Static layers" above.
- `theme` — see "Themes" above.
- `MapGroup.heading` / `MapGroup.theme` — see "Sub-layer API config" / "Themes" above.

## Known limitations / unverified DOM selectors

A few pieces of DOM-dependent logic in `nx-map-demo.component.ts`/`nx-map-builder.service.ts` are flagged in code comments as **unverified against a live render** in the installed Syncfusion version — check the console/DOM and adjust the selector if any of these don't behave as expected:

- `NXMapBuilderService.resolveClickedGraphic()` / `parseTarget()` — polygon/circle click resolution via regex on the clicked element's id.
- `NxMapDemoComponent.wireResetButton()` — finds the zoom toolbar's Reset button via `[id*="_Reset"], [title="Reset"]` to correct it back to the configured `mapCenter`/`zoomFactor`.
- `NxMapDemoComponent.animateNavigationLines()` — finds rendered line `<path>` elements via `path[id*="NavigationLineIndex"]` to apply a start-to-end stroke-draw animation.

Feeding Syncfusion's own per-layer `visible` flag from app state is deliberately avoided (`nx-map-builder.service.ts`'s `refresh()`/`buildLayers()` always pass `true`) — confirmed live that Syncfusion drops an invisible layer from its internal `layersCollection` and renumbers every later layer's rendered `_LayerIndex_<n>` DOM id, desyncing any code (like the layer panel's show/hide) that maps a layer index to that id. Layer show/hide is instead a plain DOM `display:none` toggle (`syncLayerDomVisibility()`), keyed off `NXMapBuilderService.getLayerVisible()`.
