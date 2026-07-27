# NX Map Demo

Angular + Syncfusion Maps (`@syncfusion/ej2-angular-maps`) demo that renders one or more map **layers** from a JSON `MapConfig[]`. Each layer is built from named **groups** (e.g. "Main Oil Line", "Surface", "Al Wusta Facilities") containing markers, polygons, circles, and navigation lines, with a custom layer/group/item visibility panel.

## Structure

- `app/nx-map/model/nx-map-model.ts` — shared config/model interfaces (`MapConfig`, `MapGroup`, `MapPoint`, `MapLine`, `MapPolygon`, `MapCircle`, `MapOptions`, ...).
- `app/nx-map/services/nx-map-builder.service.ts` — converts `MapConfig[]` + per-layer GeoJSON shape data into Syncfusion's `LayerSettingsModel[]`. Owns per-layer state, marker/polygon click-resolution lookups, and the layer-tree used by the UI panel.
- `app/nx-map/nx-map-demo.component.ts` — demo component: renders `<ejs-maps>`, a custom layer-list panel (layer → group → item checkboxes), and wires up map interactions (marker/shape click resolution, zoom Reset correction, navigation-line draw-in animation).
- `app/nx-map/data/pdo-map-config.json` — example config: `omanv1` (main layer) + `alwusta` (SubLayer).

## Config-level features (`MapConfig`)

- `isMainLayer` — marks the base/primary layer (defaults to the first entry if none set). The main layer can't be hidden from the layer panel or via `setLayerVisible()`.
- `baseMapType: "shape" | "osm"` — renders a layer from `shapeData` (default) or OpenStreetMap tiles. **OSM is only honored on the main layer** — a SubLayer requesting OSM falls back to shape rendering with a console warning, since Syncfusion SubLayers need shapeData aligned to the base layer's coordinate system. Combining an OSM main layer with a marker-bearing SubLayer has also been observed to cause the two layers' markers to fight over visibility (a Syncfusion internal marker-rendering collision, not something fixable from the public API) — prefer `"shape"` on the main layer when SubLayers have markers.
- `mapCenter` / `zoomFactor` — initial center/zoom, mainly needed when the main layer is `"osm"` (no shapeData bounding box to auto-fit against).
- `visible` (default `true`) — set to `false` to exclude a layer entirely at build time: it won't render on the map **and** won't appear in the layer panel's filter tree. Ignored (with a warning) on the main layer. Distinct from the runtime `setLayerVisible()` toggle, which keeps a layer in the tree but hidden.

## Known limitations / unverified DOM selectors

A few pieces of DOM-dependent logic in `nx-map-demo.component.ts`/`nx-map-builder.service.ts` are flagged in code comments as **unverified against a live render** in the installed Syncfusion version — check the console/DOM and adjust the selector if any of these don't behave as expected:

- `NXMapBuilderService.resolveClickedGraphic()` / `parseTarget()` — polygon/circle click resolution via regex on the clicked element's id.
- `NxMapDemoComponent.wireResetButton()` — finds the zoom toolbar's Reset button via `[id*="_Reset"], [title="Reset"]` to correct it back to the configured `mapCenter`/`zoomFactor`.
- `NxMapDemoComponent.animateNavigationLines()` — finds rendered line `<path>` elements via `path[id*="NavigationLineIndex"]` to apply a start-to-end stroke-draw animation.
