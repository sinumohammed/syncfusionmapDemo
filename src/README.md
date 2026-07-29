# NX Map Demo

Angular + Syncfusion Maps (`@syncfusion/ej2-angular-maps`) demo that renders one or more map **layers** from config, and a layer/group/item visibility panel driven by the same data.

## Structure

- `app/nx-map/model/nx-map-model.ts` — shared config/model interfaces (`MapConfig`, `MapGroup`, `MapPoint`, `MapLine`, `MapPolygon`, `MapCircle`, `MapOptions`, `DataSource<T>`, ...).
- `app/nx-map/model/nx-map-app-config.ts` — `NXMapAppConfig`, `StaticLayerRef`, `SubLayerApiConfig`: the app-level "where does each piece of data come from" config.
- `app/nx-map/services/nx-map-config.service.ts` — resolves a `DataSource<T>` (inline/file/api) into data, and fetches+normalizes sub-layer API groups.
- `app/nx-map/services/nx-map-builder.service.ts` — converts resolved `MapConfig[]` + per-layer GeoJSON shape data into Syncfusion's `LayerSettingsModel[]`. Owns per-layer state, marker/polygon click-resolution lookups, and the layer-tree used by the UI panel.
- `app/nx-map/nx-map-demo.component.ts` — demo component: resolves `NXMapAppConfig` into map data, renders `<ejs-maps>`, a custom layer-list panel (layer → group/heading → item checkboxes), and wires up map interactions.
- `app/nx-map/data/pdo-map-config.json` — an `NXMapAppConfig`: base layer, static layers, and sub-layer API config.
- `assets/nx-map/` — shape/boundary GeoJSON and static-layer `MapConfig` JSON, served as static HTTP assets (fetched via `HttpClient`, not bundled).
- `assets/mock-api/` — stand-in JSON responses for the sub-layer API until a real backend exists (see below).

## `NXMapAppConfig` — where the data comes from

`pdo-map-config.json` isn't the map data itself — it's a description of where each piece comes from, so a deployment can swap sources without code changes:

```ts
interface NXMapAppConfig {
  baseLayerConfigSource: DataSource<MapConfig>; // the base layer's own groups (usually empty — see below); its `layerName` is the only source of truth for the base layer's name — no separate field for it
  shapeDataSource?: DataSource<any>;            // the base layer's boundary GeoJSON — same property name as StaticLayerRef.shapeDataSource below; omit to fall back to the bundled SHAPE_DATA_BY_LAYER_NAME registry (data/shape-data-registry.ts), keyed by the base layer's own layerName
  staticLayers: StaticLayerRef[];               // hardcoded layers, each with their own config + shape source
  subLayerApis: SubLayerApiConfig[];            // one or more endpoints returning MapGroup(s) at runtime
}

interface DataSource<T> {
  source: "inline" | "file" | "api";
  value?: T;    // when source === "inline"
  url?: string; // when source === "file" | "api" — both resolved via HttpClient.get
}
```

- **Base layer** (its name is whatever `baseLayerConfigSource` resolves to, e.g. `"omanv1"` — not a separate config field) — the outer country/region shape. It's usually just the boundary with **no groups of its own** (`groups: []`); its job is to give every other layer/sub-layer something to render relative to. Its shape/boundary geometry (`shapeDataSource`) and its group/marker config (`baseLayerConfigSource`) are independent sources — either can be `"inline"`, `"file"`, or `"api"`.
- **Static layers** (`staticLayers: StaticLayerRef[]`) — hardcoded layers with their own real boundary/shapeData (genuinely separate Syncfusion `SubLayer`s, same mechanism as a governorate boundary). Each entry:
  - `parentLayerName?` (default: the base layer's own `layerName`) — nests this layer under the base layer's node in the filter popup. It still renders as its own independent Syncfusion `SubLayer` on the map; this only affects how the filter tree groups things visually.
  - `participateInFilter?` (default `true`) — set `false` to keep a layer rendering on the map while omitting it from the filter popup entirely (distinct from the existing `MapConfig.visible: false`, which excludes a layer from both the map **and** the filter).
- **Sub-layer API config** (`subLayerApis: SubLayerApiConfig[]`) — purely configuration, no data. Each entry is one endpoint URL plus an optional default `heading`. The actual `MapGroup[]` content arrives only at runtime from the API call(s), and is merged straight into the **base layer's** `groups[]` — sub-layers share the base layer's geography, so unlike static layers they don't get their own Syncfusion layer (see the "same geography → groups, not layers" guidance in `nx-map-builder.service.ts`).

**No real sub-layer API exists yet.** `subLayerApis` currently points at `assets/mock-api/mol-groups.json` and `assets/mock-api/surface-groups.json` — static JSON served over real HTTP (via `HttpClient.get`, exactly like a live endpoint), containing the `mol`/`surface` groups that used to be hardcoded directly under `omanv1`. Swapping to a real backend later is a one-line config change (replace the `url`s) — no other code changes needed.

## Filter popup structure

Three toggle levels, same as before, plus two additions:

- **Layer** checkbox — hides the whole region (shape + everything in it). Disabled for the base/main layer.
- **Heading** (new) — a toggleable section bucketing groups that share the same `MapGroup.heading` (typically groups delivered by a sub-layer API call, tagged via `SubLayerApiConfig.heading`). Checking/unchecking it flips visibility for every group nested under it. Groups without a `heading` render directly under their layer, same as before.
- **Group** checkbox — hides that group's markers/lines/polygons/circles.
- **Item** checkbox — hides one specific marker/polygon/circle/line.
- **Nested layers** (new) — a layer whose `MapConfig.parentLayerName` matches another loaded layer's `layerName` renders nested under that layer's node instead of as a top-level sibling (used for static layers under the base/Oman layer). A layer with `participateInFilter: false` renders on the map but has no node in the tree at all.

`NXMapBuilderService.getLayerTree()` builds this whole structure (`LayerTreeNode.groups`/`.headings`/`.children`) from the resolved `MapConfig[]`; the component template renders it via a self-referencing `ng-template` (`layerNodeTpl`) so nesting depth isn't hardcoded.

## Config-level features (`MapConfig`)

- `isMainLayer` — marks the base/primary layer (defaults to the first entry if none set). The main layer can't be hidden from the layer panel or via `setLayerVisible()`.
- `baseMapType: "shape" | "osm"` — renders a layer from `shapeData` (default) or OpenStreetMap tiles. **OSM is only honored on the main layer** — a SubLayer requesting OSM falls back to shape rendering with a console warning. Combining an OSM main layer with a marker-bearing SubLayer has also been observed to cause the two layers' markers to fight over visibility — prefer `"shape"` on the main layer when SubLayers have markers.
- `mapCenter` / `zoomFactor` — initial center/zoom, mainly needed when the main layer is `"osm"` (no shapeData bounding box to auto-fit against).
- `visible` (default `true`) — set to `false` to exclude a layer entirely at build time: it won't render on the map **and** won't appear in the layer panel's filter tree. Ignored (with a warning) on the main layer. Distinct from `participateInFilter` (map yes, filter no) and the runtime `setLayerVisible()` toggle (keeps a layer in the tree but hidden).
- `parentLayerName` / `participateInFilter` — see "Static layers" above.
- `MapGroup.heading` — see "Sub-layer API config" / "Filter popup structure" above.

## Known limitations / unverified DOM selectors

A few pieces of DOM-dependent logic in `nx-map-demo.component.ts`/`nx-map-builder.service.ts` are flagged in code comments as **unverified against a live render** in the installed Syncfusion version — check the console/DOM and adjust the selector if any of these don't behave as expected:

- `NXMapBuilderService.resolveClickedGraphic()` / `parseTarget()` — polygon/circle click resolution via regex on the clicked element's id.
- `NxMapDemoComponent.wireResetButton()` — finds the zoom toolbar's Reset button via `[id*="_Reset"], [title="Reset"]` to correct it back to the configured `mapCenter`/`zoomFactor`.
- `NxMapDemoComponent.animateNavigationLines()` — finds rendered line `<path>` elements via `path[id*="NavigationLineIndex"]` to apply a start-to-end stroke-draw animation.
