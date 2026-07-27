import { NXMapBuilderService } from "../src/app/nx-map/services/nx-map-builder.service";
import { MapConfig, MapOptions } from "../src/app/nx-map/model/nx-map-model";
import * as configJson from "../src/app/nx-map/data/pdo-map-config.json";

let failures = 0;

function assertEqual(label: string, actual: number, expected: number) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: expected ${expected}, got ${actual}`);
  if (!ok) failures++;
}

function assertTrue(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failures++;
}

// pdo-map-config.json now holds two real entries: "omanv1" (groups "mol",
// "surface") and "alwusta" (group "alwusta-facility") — use both directly
// rather than hardcoding a synthetic second layer, so this test tracks
// whatever is actually in the file.
const configs: MapConfig[] = (configJson as any).default ?? configJson;
const omanConfig = configs.find(c => c.layerName === "omanv1")!;
const alwustaConfig = configs.find(c => c.layerName === "alwusta")!;
// The rest of this file exercises the normal two-layer build, independent of
// whatever `visible` the live JSON currently has on alwusta (e.g. while
// someone's manually testing the visible: false exclusion feature in the
// browser) — the exclusion behavior itself gets its own dedicated check
// further down, against a cloned config.
alwustaConfig.visible = true;
const molGroupId = omanConfig.groups!.find(g => g.name === "Main Oil Line")!.id;
const surfaceGroupId = omanConfig.groups!.find(g => g.name === "Surface")!.id;

const shapeDataByLayer = Object.fromEntries(
  configs.map(c => [c.layerName, { type: "FeatureCollection", features: [] }])
);

const builder = new NXMapBuilderService();

// --- Multi-layer build (using the file's real two layers) ---
const options: MapOptions = builder.buildMap(configs, shapeDataByLayer);

const omanLayerIndex = configs.indexOf(omanConfig);
const alwustaLayerIndex = configs.indexOf(alwustaConfig);

assertEqual("layers.length (one per MapConfig entry)", options.layers.length, configs.length);

const omanMarkerCounts = (options.layers[omanLayerIndex].markerSettings as any[]).map(m => m.dataSource.length);

assertEqual("oman layer marker groups", options.layers[omanLayerIndex].markerSettings.length, 2);
assertEqual("mol markers", omanMarkerCounts[0], 5);
assertEqual("surface markers (4 top-level + 1 nested 'Surface DALEEL')", omanMarkerCounts[1], 5);
assertEqual(
  "alwusta layer marker groups",
  options.layers[alwustaLayerIndex].markerSettings.length,
  1
);
assertEqual(
  "alwusta markers",
  (options.layers[alwustaLayerIndex].markerSettings[0] as any).dataSource.length,
  3
);

assertEqual("oman layer type (base layer)", (options.layers[omanLayerIndex] as any).type, "Layer" as any);
assertEqual("alwusta layer type (SubLayer)", (options.layers[alwustaLayerIndex] as any).type, "SubLayer" as any);

// Nested point flattening: confirm "Surface DALEEL" surfaced as its own marker.
const surfaceNames = (options.layers[omanLayerIndex].markerSettings[1].dataSource as any[]).map(d => d.name);
assertTrue(
  "nested point 'Surface DALEEL' flattened into surface markers",
  surfaceNames.includes("Surface DALEEL")
);

// --- markerClick resolution must not collide across layers ---
const molMarker = options.layers[omanLayerIndex].markerSettings[0].dataSource[2]; // "Nahda Booster Station HI POINT"
const alwustaMarker = options.layers[alwustaLayerIndex].markerSettings[0].dataSource[0];

const resolvedMol = builder.resolveMarkerClick({ data: molMarker });
const resolvedAlwusta = builder.resolveMarkerClick({ data: alwustaMarker });

assertTrue(
  "oman-layer marker resolves to its own group, not alwusta's",
  resolvedMol?.groupId === molGroupId &&
    (resolvedMol.object as any).name === "Nahda Booster Station HI POINT"
);
assertTrue(
  "alwusta-layer marker resolves to its own group, not oman's",
  resolvedAlwusta?.groupId === "alwusta-facility"
);
assertTrue(
  "the two layers' resolved markers are distinct objects (no index collision)",
  resolvedMol !== resolvedAlwusta
);

// --- getLayerTree() exposes live references + per-layer/group/item toggles ---
const tree = builder.getLayerTree();
assertEqual("getLayerTree() returns one node per layer", tree.length, configs.length);

const omanNode = tree[omanLayerIndex];
const molEntry = omanNode.groups.find(g => g.group.id === molGroupId)!;

// Toggle a single marker off — only that marker should disappear from the
// built dataSource, its siblings and its group must stay visible.
const targetMarkerName = "Nahda Booster Station HI POINT";
const targetMarker = molEntry.markers.find(m => m.name === targetMarkerName)!;
targetMarker.visible = false;
builder.refresh(options);

const molNamesAfterMarkerHide = (options.layers[omanLayerIndex].markerSettings[0].dataSource as any[]).map(
  d => d.name
);
assertTrue(
  "hiding one marker removes only that marker from the built dataSource",
  !molNamesAfterMarkerHide.includes(targetMarkerName) && molNamesAfterMarkerHide.length === 4
);

targetMarker.visible = true; // restore for subsequent checks
builder.refresh(options);
assertEqual(
  "re-showing that marker restores the count",
  (options.layers[omanLayerIndex].markerSettings[0].dataSource as any[]).length,
  5
);

// Toggle a single polygon off (mol group's "Muscat" polygon) — its circle
// sibling must stay.
const molPolygon = molEntry.polygons.find(p => p.name === "Muscat")!;
const totalPolygonsBefore = options.layers[omanLayerIndex].polygonSettings.polygons.length;
molPolygon.visible = false;
builder.refresh(options);
assertEqual(
  "hiding one polygon removes exactly one entry from the built polygons array",
  options.layers[omanLayerIndex].polygonSettings.polygons.length,
  totalPolygonsBefore - 1
);
molPolygon.visible = true;
builder.refresh(options);
assertEqual(
  "re-showing that polygon restores the count",
  options.layers[omanLayerIndex].polygonSettings.polygons.length,
  totalPolygonsBefore
);

// Toggle a single circle off.
const molCircle = molEntry.circles[0];
molCircle.visible = false;
builder.refresh(options);
assertEqual(
  "hiding the only circle in mol removes one from the built polygons array",
  options.layers[omanLayerIndex].polygonSettings.polygons.length,
  totalPolygonsBefore - 1
);
molCircle.visible = true;
builder.refresh(options);

// Toggle a single line off.
const molLine = molEntry.lines[0];
molLine.visible = false;
builder.refresh(options);
assertEqual(
  "hiding the only line in mol empties oman's navigationLineSettings for that group",
  options.layers[omanLayerIndex].navigationLineSettings.length,
  1 // surface group's line still present
);
molLine.visible = true;
builder.refresh(options);

// --- Layer-level visibility hides the whole layer (shape + everything) ---
builder.setLayerVisible(alwustaLayerIndex, false);
builder.refresh(options);
assertTrue(
  "setLayerVisible(false) marks that Syncfusion layer's own `visible` flag false",
  (options.layers[alwustaLayerIndex] as any).visible === false
);
assertTrue(
  "the OTHER layer's visible flag is untouched",
  (options.layers[omanLayerIndex] as any).visible !== false
);
builder.setLayerVisible(alwustaLayerIndex, true);
builder.refresh(options);

// --- Main layer identification + protection ---
const treeAfterInit = builder.getLayerTree();
assertTrue(
  "omanv1 (isMainLayer: true in JSON) is flagged as the main layer",
  treeAfterInit[omanLayerIndex].isMainLayer === true
);
assertTrue(
  "alwusta (no isMainLayer field) is NOT flagged as the main layer",
  treeAfterInit[alwustaLayerIndex].isMainLayer === false
);
assertEqual("getMainLayerIndex() matches the JSON-flagged layer", builder.getMainLayerIndex(), omanLayerIndex);

builder.setLayerVisible(omanLayerIndex, false);
builder.refresh(options);
assertTrue(
  "setLayerVisible(mainLayer, false) is a no-op — main layer stays visible",
  (options.layers[omanLayerIndex] as any).visible !== false
);

// --- Group-level showGroups() still works (host app's existing API) ---
builder.showGroups([molGroupId]);
builder.refresh(options);
assertEqual("showGroups([mol]) leaves only mol's marker layer", options.layers[omanLayerIndex].markerSettings.length, 1);
assertEqual(
  "showGroups([mol]) hides alwusta's group too (not in the id list)",
  options.layers[alwustaLayerIndex].markerSettings.length,
  0
);

// --- Deselect to empty across all layers ---
builder.showGroups([]);
builder.refresh(options);
assertEqual("deselecting everything empties oman markers", options.layers[omanLayerIndex].markerSettings.length, 0);
assertEqual(
  "deselecting everything empties alwusta markers",
  options.layers[alwustaLayerIndex].markerSettings.length,
  0
);

// restore for idempotency check below
builder.showGroups([molGroupId, surfaceGroupId, "alwusta-facility"]);

// --- Re-running initialize on the same configs must be idempotent ---
builder.initialize(configs, shapeDataByLayer);
const secondFlattenCount = (builder as any).layers[omanLayerIndex].groups[1].markerConfig.points.length;
assertEqual("re-initialize is idempotent (surface markers still 5, not doubled)", secondFlattenCount, 5);

// --- Config-time exclusion: visible: false drops a layer entirely ---
const excludedConfigs: MapConfig[] = configs.map(c =>
  c.layerName === "alwusta" ? { ...c, visible: false } : c
);
const excludedBuilder = new NXMapBuilderService();
const excludedOptions = excludedBuilder.buildMap(excludedConfigs, shapeDataByLayer);
assertEqual(
  "visible: false on alwusta excludes it from the built layers",
  excludedOptions.layers.length,
  1
);
assertEqual(
  "visible: false on alwusta also excludes it from getLayerTree()",
  excludedBuilder.getLayerTree().length,
  1
);
assertTrue(
  "the remaining layer is still omanv1 (main layer untouched)",
  excludedBuilder.getLayerTree()[0].layerName === "omanv1"
);

// --- Config-time exclusion is refused on the main layer ---
const excludedMainConfigs: MapConfig[] = configs.map(c =>
  c.layerName === "omanv1" ? { ...c, visible: false } : c
);
const excludedMainBuilder = new NXMapBuilderService();
excludedMainBuilder.buildMap(excludedMainConfigs, shapeDataByLayer);
assertEqual(
  "visible: false on the main layer is ignored — both layers still build",
  excludedMainBuilder.getLayerTree().length,
  2
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
