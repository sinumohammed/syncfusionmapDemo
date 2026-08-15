# NX Map Demo — Session Notes

Summary of work done on the `nx-map` feature in this session. For the current architecture/config reference, see [`src/README.md`](src/README.md); this file is a chronological log of what changed and why.

## 1. Config-driven map layers

Replaced the hardcoded `MapConfig[]` + static JSON imports with an app-level config (`src/app/nx-map/data/pdo-map-config.json`, shape defined by `NXMapAppConfig` in `src/app/nx-map/model/nx-map-app-config.ts`) describing **where** each piece of data comes from — `"inline"` (embedded directly in the JSON), `"file"` (a static asset fetched via `HttpClient`), or `"api"` (a live endpoint) — via a shared `DataSource<T>` shape resolved by the new `NXMapConfigService`.

- **Base layer** (`omanv1`/"Oman"): its own config and its shape/boundary GeoJSON each resolve independently, so one can be inline while the other is file-based, etc. Proved both directions work: inlined `oman-shape.json`'s full content directly into the config (zero HTTP requests for the shape file), then reverted back to `"file"` on request.
- **Static layers**: 6 hardcoded layers (`alwusta`, `musandam`, `al-buraymi`, `al-dhahira`, `dhofar`, `ad-dakhliyah`), each a genuine separate Syncfusion SubLayer with its own shape/config, but nested under the base layer in the filter popup via `parentLayerName`. `participateInFilter: false` (used on `ad-dakhliyah`) keeps a layer rendering on the map while hiding it from the filter tree entirely.
- **Sub-layer groups** (`mol`/`surface`, sharing the base layer's geography): originally two mock endpoints, later consolidated into one (`src/assets/mock-api/sublayer-groups.json`) per a later request — each group carries its own `heading` so a single response can still populate multiple filter-tree headings.

## 2. Sub-layer reload mechanism

`NXMapConfigService.loadSubLayerGroup(api, payload?)` re-fetches one endpoint with a payload (sent as query params — verified `ng serve`'s static-asset middleware returns 404 on POST, so query params were used instead of a request body). `NxMapDemoComponent.reloadSubLayerGroups(payload?, apiIndex?, urlOverride?)` calls it and **replaces** `subLayerGroups` outright (not appends) before rebuilding the map — verified empirically that calling it twice keeps the marker count stable rather than doubling.

Added a manual **"Reload Sub-Layers"** button in the filter popup (`reloadSubLayerGroupsDemo()`) that alternates between the full 2-group mock response and a partial 1-group one (`sublayer-groups-partial.json`), so clicking it visibly proves groups get replaced — confirmed the "Surface" heading fully disappears from the popup on one click and returns on the next, not just stops rendering on the map.

## 3. Filter popup: tri-state checkboxes

Group/heading/layer checkboxes now show **indeterminate** state (via `groupState()`/`headingState()`/`layerState()` in the component, bound to `[indeterminate]`) when only some of their descendants are visible — not just checked/unchecked. Toggling a leaf item now bubbles up correctly (checking one leaf shows its group and heading as indeterminate, and the layer above too); toggling a parent cascades the same show/hide down through every descendant. Checking a single leaf back on also re-enables its parent group's own `visible` flag, since a group with `visible: false` hides its contents regardless of individual leaf state.

## 4. Filter popup: search box

A plain text input filters the tree live (case-insensitive substring match against layer/heading/group/leaf names), keeping the full ancestor chain visible for any match so you can see where a found item sits in the hierarchy.

## 5. On-screen click feedback

Clicking a marker/polygon/circle now shows a brief on-screen toast (`"You clicked "<name>" in "<group>""`, 2.5s, top-center of the map) in addition to the existing `console.log`.

## 6. Bugs found and fixed along the way

- **Markers disappearing during zoom (in/out/reset)**: reproduced for real — a genuine zoom transform dropped one marker-bearing layer's DOM elements entirely while another's stayed. Fixed by re-calling the Maps component's own `refresh()` on Syncfusion's `zoomComplete` event, **debounced** (`clearTimeout` before each new `setTimeout`) so continuous zooming doesn't stack overlapping refreshes — an earlier un-debounced version of this fix caused the map to go blank after repeated zooming, which was reverted and redone correctly.
- **Musandam clipped at the top edge**: its shape geometry sat right at Oman's real northern boundary (26.386°) with no margin; pulled it south and recalibrated the base layer's `mapCenter` latitude (21.0 → 21.8) to give it clearance.
- **Page needing a scroll to see the map**: a few px of unavoidable rounding/scrollbar-feedback overflow was clamped with `overflow: hidden` on `html`/`body`.
- **Wheel-zoom-out guard**: added a capture-phase `wheel` listener meant to block scrolling out past the minimum zoom, but its direction-detection assumption (`deltaY > 0` = zoom out) broke zoom-*in* entirely for scroll conventions where that assumption doesn't hold. Reverted rather than patched, since it was never actually verified against real wheel input in this environment.
- **Static layer shapes "invisible"**: they were real, just tiny (~30px) next to Al Wusta's full governorate boundary (~250px) — rescaled to a comparable, verified-visible size.
- **TS `strictPropertyInitialization` errors** on `mapInstance`/`mapOptions`: fixed with definite-assignment assertions (`!`), since both are legitimately assigned outside the constructor and every read was already guarded.

## 7. Per-marker donut metrics

Every `mol` marker point carries a reading for all 7 donut metrics (`tvp`, `salt`, `bsw`, `h2s`, `api`, `flow`, `other`) via `PointMetric { value, unit?, status: "high"|"normal", impact?: "customer"|"non-customer" }` on `MapPoint.metrics`. Clicking a donut card labels **every** MOL marker with that metric's value; only `status: "high"` markers get the metric's own highlight color (`NXMapBuilderService.METRIC_COLORS`), the rest get a shared neutral color. A donut's own two slice counts are the **"high" population only**, split by `impact` ("Customer impact" vs "Non-customer impact") — not the full high+normal count, and not the same thing driving marker color. `impact` is unset (and unread) on any `"normal"` reading.

High-impact markers are further differentiated by **shape** — customer vs non-customer — via `MapGroup.impactMarkerStyle` (per-group override) falling back to `NXMapBuilderService.DEFAULT_IMPACT_SHAPES` (customer → diamond, non-customer → triangle) falling back to a plain circle if a "high" reading has no `impact` at all.

A donut with zero markers for its metric (0/0 — every reading `"normal"`) renders a muted gray placeholder ring with "No data" text instead of a real chart segment, via `NxDonutComponent.isEmpty`, but stays clickable per explicit requirement — clicking it still labels every marker with that metric's (all-normal) values.

Metric values shown on donut click are derived **directly from each point's own already-loaded `metrics` field** (`NxMapDemoComponent.extractMetricValues()`) — an earlier version fetched a separate per-metric mock JSON file (`assets/mock-api/marker-values/<id>.json`) to simulate a live "pass the donut name, get values back" endpoint, but since the same values were already duplicated on every point, those files were dropped as redundant.

## 8. Map collection component

`NxMapCollectionComponent` loops over a config-driven array of maps (`MapCollectionConfig<T>{ maps: DataSource<T>[] }`) instead of one hardcoded `<app-nx-map-demo>`, resolving each entry the same way `NxDonutCollectionComponent` already did for donuts. Supports a real-world payload shape where the top-level node is `ComponentType: 7119` (`MAP_COLLECTION_COMPONENT_TYPE`) whose `Configuration[]` is the array of maps to render (`buildMapCollectionConfig()` in `parent-config-transform.ts`) — `app.component.ts` now binds this instead of a single map, broadcasting donut selections to every map instance via `@ViewChildren(NxMapDemoComponent)`.

## 9. Marker overlay positioning and hover-blocking

The always-visible metric-value overlay icon (shown once a donut is selected) needed to sit **exactly** on the real marker point — an early version was visibly offset because it applied `translate(-50%,-50%)` a second time on top of a transform Syncfusion's own template wrapper div already applies; fixed by dropping the duplicate transform and using `height:0; overflow:visible` plus a per-shape `translateY(-50%)` instead.

The same overlay icon also intercepted hover, blocking the underlying real marker's tooltip on some points — traced to **two independent** inline `pointer-events: auto` overrides from Syncfusion (one on its own wrapper div, `[class*="_marker_template_element"]`, one it stamps directly onto `.marker-label` itself), both needing `!important` to actually override.

## 10. Layer paint order vs. hover / visibility

`NXMapBuilderService.buildLayers()` stable-sorts the **rendered** layer array so any layer with markers always paints (and hit-tests) last/on top, regardless of declared order in config — otherwise a marker-less layer declared after a marker-bearing one silently ate every hover event over those markers, its own shape polygon intercepting the pointer even though the markers were still visibly there underneath. Declared order (`this.layers`, index-keyed) is left untouched so the filter-tree panel still lists layers the way the config wrote them.

That reorder later turned out to be a trap for anything keyed by **position** instead of **original layerIndex** (see §15).

## 11. Toolbar resize/reset regressions

- **Layer/layer-list icons snapping to the far-left edge during a browser resize**: Syncfusion's toolbar can still be mid-move well past a short poll window; fixed with a longer poll (up to ~1.2s across 15 animation-frame-spaced attempts) plus a guaranteed trailing re-measure ~700ms after the last resize event.
- **Reset button falling back to Syncfusion's own uncorrected "reset to initial"**: `refresh()` (run on every zoom) regenerates the toolbar's SVG DOM wholesale, silently orphaning a click listener attached directly to the old Reset button node. Fixed by delegating a single click listener from the component's own host element (never destroyed by Syncfusion) instead of the button itself — see `wireResetButton()`'s own comment — so it survives the toolbar being regenerated any number of times.

## 12. Zoom recentering on Map/Satellite styles

Zooming (scroll or toolbar) on a tile-based (`osm`/`satellite`) main layer used to always snap back to the map's originally-configured center once the zoom settled, instead of staying on whatever area was actually zoomed toward. Fixed in `onZoomComplete()` by capturing the live center via `getTileGeoLocation()` at the current `mapAreaRect` center and re-applying it with `zoomByPosition()` after `refresh()` — gated by `isTileMap` so **shape**-mode zoom behavior is untouched.

This fix has a documented regression history worth respecting: a first attempt captured/reapplied `centerPosition` unconditionally for every base map type and broke previously-working shape-mode zoom too — reverted immediately. Any further change here must stay scoped to tile base maps only.

## 13. Donut metric tooltip customization

Marker hover tooltips were a hardcoded 7-metric/2-column layout with no way to change which metrics show or how many per row. Replaced with `MapConfig.tooltipTemplate: TooltipTemplateConfig { columns, items: { metricId, title? }[] }`, checked on the main layer first, then each static layer (e.g. `mol`) in order, falling back to `NXMapBuilderService.DEFAULT_TOOLTIP_TEMPLATE` (the original layout) when unset. `NxMapDemoComponent.injectMarkerTooltipTemplate()` builds the tile grid HTML dynamically from this config; `PointMetric` gained reserved `value2/unit2/value3/unit3` fields for a tile's optional extra line(s), hidden per-point (via a computed CSS `display` field) until actually populated.

Hit one race while wiring this up: `ngAfterViewInit()` unconditionally re-injected the *default* template, which — since the real config resolves synchronously from a bundled inline JSON import, not a real HTTP call — ran **after** `loadMap()`'s subscribe had already injected the correct config-driven one, silently stomping it back to default every time. Fixed by only falling back to the default in `ngAfterViewInit()` when no template has been injected yet.

## 14. Impact split extended to the Reload Sub-Layers demo data

`sublayer-groups.json`/`sublayer-groups-partial.json` (the separate mock data used only by the manual "Reload Sub-Layers" button — **not** what `real-parent-config.json`'s inline MOL config uses) had `status` on every metric but no `impact`, so their "high" markers never differentiated by shape. Added `impact: "customer"|"non-customer"` to all 28 high readings in each file (14/14 split, identical between both since they share the same point/metric data).

## 15. Layer toggle scrambling markers (paint-order bug, part 2)

§10's reorder fix shifts a layer's position in `mapOptions.layers` away from its original `layerIndex` whenever paint order and declared order diverge (e.g. Al Wusta, no markers, moves ahead of MOL, which has markers). Two places still assumed DOM/array position == original `layerIndex`:

- `syncLayerDomVisibility()` hid/showed the wrong layer's DOM group — unchecking Al Wusta left its shape/background on screen (the wrong group got hidden) and re-checking it appeared to do nothing.
- `NXMapBuilderService.refresh()` (run on every layer/group toggle) rebuilt each *position's* `markerSettings`/`navigationLineSettings`/`polygonSettings` from the wrong layer's data — unchecking Al Wusta silently wiped MOL's markers off the map entirely, only "fixed" by whatever next triggered a full `rebuildMap()` (e.g. a donut click), since that's the only path that recomputes paint order and marker data together.

Fixed by having `buildLayers()` record a `renderOrder[renderPosition] → original layerIndex` map (`getRenderOrder()`); both call sites now translate through it before touching `this.layers` or calling the per-layer builders.

## 16. Ad hoc metric-overlay markers and matching rules

`NxMapDemoComponent.applyMetricSelection()` now supports plotting **brand-new** marker points straight from a metric-overlay API response (`MetricOverlayRecord`, fetched by `NXMapConfigService.loadMetricOverlay()`), not just re-coloring existing ones. Final matching rules, deliberately not a fallback chain:

- `layerId` given and matches a known layer → `markerId` must resolve to an **existing** point on that exact layer. Resolves → anchor (existing point gets this reading as an overlay). Doesn't resolve (missing or wrong) → **error, record skipped** — no longer silently creates a new point on that layer, so a mistyped `markerId` next to a real `layerId` always surfaces as an error instead of quietly plotting a duplicate.
- `layerId` given but doesn't match any known layer → error, record skipped.
- `layerId` omitted → no existing-point search at all (previously matched a bare `markerId` against every layer — no longer does); always a brand-new point, using `id` (or `markerId`, or an auto-generated id) as its identity, provided `latitude`/`longitude` are present.

New points don't get a separate synthetic layer. They ride along on `fallbackTarget` — the **last declared static layer that already has real, config-authored points of its own** (`pointIds.size > 0`), not just `targets[targets.length - 1]`. This matters because of a real Syncfusion constraint: under a raster tile (`osm`/`satellite`) main layer, only the layer that's *already* marker-bearing and declared last actually gets native SVG marker DOM — every other marker-bearing layer silently gets none. Naively picking the literal last target broke this: appending points to a previously marker-less trailing layer made *that* layer newly marker-bearing, stealing the native-render slot MOL relied on and silently killing MOL's own real markers' native SVG. Picking a target that's marker-bearing independent of our own addition avoids that regression.

A new point's own base marker style is copied verbatim from its host layer's own group style (e.g. MOL's `shape: Circle, height: 6, width: 6`) rather than falling back to the layer's theme — confirmed live that theme alone doesn't reproduce the actual rendered size (MOL's own points override their theme's 24×24 default down to 6×6 via their own group style). A record can still override `shape`/`color`/`width`/`height`/`minZoomLevel` for just its own point via matching `MetricOverlayRecord`/`MapPoint` fields.

## 17. Data-driven hover tooltip (no hardcoded metric-id list anywhere)

The hover tooltip used to be built from a hardcoded 7-metric list (`METRIC_KEYS`) and a hardcoded color palette (`METRIC_COLORS`) in `nx-map-builder.service.ts`, with static values that were never actually populated from any fetch. Replaced with a fully data-driven pipeline:

- `NxMapDemoComponent.deriveTooltipTemplate()` builds the tooltip's tile list from whatever metric keys a fetch's own `MetricOverlayRecord.tooltip` maps contain — a metric id no config anywhere has declared still gets a working tile the first time the data mentions it. Each tile's title comes from that metric's own `PointMetric.label` (falling back to `key.toUpperCase()`), merged with (and overridable by) a layer's own `MapConfig.tooltipTemplate.items` when one exists.
- `NXMapBuilderService.setTooltipMetricKeys()` keeps the DOM template's `${v_<key>}`/etc. placeholders and `toMarker()`'s populated fields in lockstep — same key list feeds both.
- `PointMetric` gained `label?`/`color?` — a reading's own display name and "high"-status highlight color, straight from the data. `METRIC_KEYS`/`METRIC_COLORS` are gone entirely from `nx-map-builder.service.ts`.
- `mol.json`'s own `tooltipTemplate` (static config) was removed entirely — the tooltip now works purely from `metric-overlay-response.json`'s data, with `label`s added only where a plain uppercased key wouldn't read well (`"bsw"` → "BS&W", `"h2s"` → "Dissolved H2S").

**Per-point column count and tile style**, without ever needing a real per-marker Syncfusion template: `MetricOverlayRecord.tooltip` carries two reserved non-metric keys, `"columns"` (number) and `"template"` (string), forwarded onto just the ONE point that record matches/creates (`MapPoint.tooltipColumns`/`tooltipLayout`) — every other point keeps the map-wide default. This works because the tooltip's actual tile markup is a single CSS grid (`.mtt-grid`, not pre-split into fixed rows), with `grid-template-columns` and an outer CSS class (`mtt-layout-<name>`) substituted **per-marker** via Syncfusion's own `${field}` templating (`toMarker()`: `columns`/`layoutClass`) — so every marker shares one DOM template element but can still render a genuinely different column count/tile style each. Two concrete named styles exist as examples (`nx-map-demo.component.scss`'s `TOOLTIP_TILE_LAYOUTS`-adjacent `.mtt-layout-compact`/`.mtt-layout-template2`) — adding another is just another CSS block, no other code changes. This per-point mechanism only works for layouts that are CSS-only restyles of the same tile markup; a genuinely different HTML structure per tile is a **config-level** choice instead (`TooltipTemplateConfig.layout`, resolved once per layer/app via the `TOOLTIP_TILE_LAYOUTS` registry in `nx-map-demo.component.ts`).

## 18. Satellite/OSM zoom capped well short of real imagery

Zooming into satellite (or OSM) mode stopped well before individual wells/stations became visible, even though the same tile provider serves much closer zoom fine elsewhere. Root cause: Syncfusion's `ZoomSettingsModel.maxZoom` defaults to **10** when left unset, and `NXMapBuilderService.buildZoom()` never overrode it. Added `MapConfig.maxZoomFactor?: number`, defaulting to 18 (not 19 — confirmed live that 19 let the ZoomIn button take one click past what ArcGIS World Imagery actually has tiles for at a typical well/station location, landing on a blank tile right as ZoomIn disabled itself).

## 19. Zoom-gated marker visibility (`minZoomLevel`)

`MapGroup.minZoomLevel`/`MapPoint.minZoomLevel` (point-level overrides group-level) hide a marker entirely below a configurable map zoom factor — e.g. well/station points that shouldn't clutter a zoomed-out view. `NXMapBuilderService.buildMarkerPoints()` filters points by `currentZoomLevel >= (point.minZoomLevel ?? group.minZoomLevel ?? -Infinity)`; `setZoomLevel()` (called from `NxMapDemoComponent.onZoomComplete()` on every real zoom, and seeded correctly at the map's actual starting zoom inside `buildZoom()` itself) keeps it current. Verified live end-to-end: a point given `minZoomLevel: 10` correctly started hidden at the default zoom (7) and reappeared once zoomed past 10.

## Files touched

See `git log` / `git show db63273` for the earlier work (§1–6). For everything since (§7–15), see commits from `Add satellite/map/shape base-map style switcher to nx-map` onward — main additions are `src/app/nx-donut/**` (donut chart + collection components), `src/app/nx-map/nx-map-collection.component.ts`, `src/app/nx-map/model/nx-map-model.ts`'s `PointMetric`/`TooltipTemplateConfig` additions, and further substantial rewrites of `nx-map-demo.component.ts` and `nx-map-builder.service.ts`.

For §16–19, see commits `4405f43`..`14bbd6b` (`git log --oneline 4405f43..14bbd6b`) — main touches are `nx-map-demo.component.ts` (`applyMetricSelection()`/`deriveTooltipTemplate()`/`applyTooltipTemplate()`/`onZoomComplete()`), `nx-map-builder.service.ts` (`buildMarkerPoints()`/`toMarker()`/`buildZoom()`, `METRIC_KEYS`/`METRIC_COLORS` removed), `nx-map-model.ts` (`MetricOverlayRecord.tooltip`, `PointMetric.label`/`.color`, `MapGroup`/`MapPoint.minZoomLevel`, `MapPoint.tooltipColumns`/`.tooltipLayout`, `MapConfig.maxZoomFactor`), `nx-map-demo.component.scss` (`.mtt-grid`, `.mtt-layout-*`), and `metric-overlay-response.json`/`mol.json`.
