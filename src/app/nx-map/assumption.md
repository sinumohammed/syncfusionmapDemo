# Planning notes: shared default static layers (NOT implemented yet)

Captured from discussion so it can be picked up later. Nothing in this doc
has been built — `nx-map-model.ts`, `nx-map-builder.service.ts`,
`parent-config-transform.ts`, and `real-parent-config.json` are all
unchanged as of writing this.

## Context / problem

- `pdo-map-config.json` is legacy/unused — we only deal with
  `src/app/nx-map/testing/real-parent-config.json` now.
- In `real-parent-config.json`'s terms:
  - Top level `MAP COLLECTION` → `Configuration[]` = one entry per map
    (today just `OMAN_BASE_MAP`).
  - Each map entry (`OMAN_BASE_MAP`) is a `RawLayerNode` and becomes that
    map's **parent/base layer** (`buildAppConfig()` parses its own
    `LayerConfigJSON` → `{"layerName":"oman",...}`).
  - That parent's own `Configuration[]` (today: `MOL`, `AL_WUSTA_LAYER`) are
    its **child** static layers.
- Problem: MOL/Al Wusta currently have to be re-declared, full JSON and all,
  inside every parent/every map/every app that wants them. Goal: define
  once, reuse everywhere automatically, override per-app/per-map without a
  redeploy.

## Agreed design

Two categories of shared default, because MOL and Al Wusta are structurally
different:

1. **Default groups** (MOL-style — plain `markerConfig`/`polygons`/`lines`,
   no real geographic boundary needed). Bundled `MapGroup[]` merged straight
   into the parent's own `groups[]` — same mechanism `subLayerApis` groups
   already go through today (`mergedBase.groups = [...baseConfig.groups,
   ...subLayerGroups]` in `NxMapDemoComponent.rebuildMap()`). No separate
   SubLayer needed for this case.

2. **Default static shape layers** (Al Wusta-style — real GeoJSON boundary,
   `shapeFeaturesSelectable` click-to-identify, region-clustered features
   via `properties.region`). These need Syncfusion's real shape-layer
   machinery, which only exists for a true `StaticLayerRef`/SubLayer — a
   plain group's polygon can't do click-to-identify or per-feature region
   bucketing. Stays as a full `StaticLayerRef`, auto-injected into a
   parent's `staticLayers` when that parent's own `Configuration[]` is
   empty/absent. A parent that supplies its own `Configuration[]` keeps
   using it exactly as today (full override, same schema).

Both bundled defaults must be **runtime-fetched** (a `file` `DataSource` via
`HttpClient`, same mechanism `LayerConfigSource: 1` already uses for any
real layer today) — NOT compiled into the app bundle via a TS import (that
was rejected: no redeploy to change a default). This means:

- `buildAppConfig()` is 100% synchronous today (just reads the
  already-in-hand `RawLayerNode` tree). Pulling in a fetched default file
  makes that step async — needs folding into `NxMapDemoComponent.loadMap()`'s
  existing `forkJoin`/`switchMap` pipeline rather than being called directly
  from `ngOnChanges`.

Override precedence, either category: a parent/app that supplies its own
entry (a group with the same id, or its own `Configuration` for a shape
layer) wins — same "override wins" precedence already used for
`theme`/`parentLayerName` elsewhere in this codebase.

## New field also needed: `MapConfig.selected`

Separate from all of the above but needed to make "default selected" actually
work:

- `MapConfig.selected?: boolean`, default `true`.
- Unlike `visible: false` (excludes the layer from the map AND the filter
  tree entirely, config-time), `selected: false` keeps the layer present but
  starts it **unchecked** — same as if a user unchecked it right after load.
- Wire into `NXMapBuilderService.initialize()`'s per-layer starting
  `visible` state (currently hardcoded `visible: true`) →
  `visible: config.selected ?? true`.
- Main layer should be exempted the same way `visible: false` already is on
  the main layer (its checkbox is disabled in the layer panel, so starting
  it unchecked would leave no way to check it back on) — warn + include it
  fully checked anyway.

## How turning a default on/off looks once built

- **Global** (every map/app relying on the shared default): edit the one
  entry inside the shared default JSON file — e.g. add `"selected":false`
  (stays on map, starts unchecked) or `"visible":false` (fully excluded) to
  Al Wusta's inline JSON, or to a specific default group.
- **Per-app/per-map** (just this one): that parent supplies its own
  `Configuration[]` entry (for a shape layer) or its own group with a
  matching id (for a default group) — same JSON shape as the bundled
  default, so it's easy to copy-and-edit — which wins over the shared
  default for that one map only.

## Still open when we pick this back up

- Exact file path/name for the bundled default groups + default static
  layers JSON (something under `src/assets/nx-map/`, resolved as a `file`
  `DataSource`).
- Exact shape of the async change to `buildAppConfig()`/`loadMap()` — likely
  `buildAppConfig()` returns an `Observable<NXMapAppConfig>` (or a new
  function wraps it) so it composes into the existing `switchMap` chain.
- Whether `MapConfig.selected` ships as part of this same change or
  separately first (it's independent and lower-risk, could land on its own).
