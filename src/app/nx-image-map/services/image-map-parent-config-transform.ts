import {
  ImageMapConfig,
  ImageMapDataSource,
  ImageMapLayerFile,
  ImageMapMainLayerSettings,
  ImageMapTooltipFormat,
  RawImageMapNode
} from "../model/nx-image-map-model";

// Same conventions as nx-map's parent-config-transform.ts (same field names,
// same comma-list/slug/JSON-string rules). The raw-node and tooltip-format
// TYPES are shared (../../nx-map-common); this transform stays per component.

// COMPONENT_NX_MAP_IMAGE_COLLECTION — its Configuration[] holds one
// COMPONENT_NX_MAP_IMAGE (7124) node per image map.
const IMAGE_MAP_COLLECTION_COMPONENT_TYPE = 7125;

// Where every LayerFileLists name resolves to on disk.
export const IMAGE_MAP_LAYER_FILES_BASE_PATH = "assets/nx-image-map/layers";

// "Fuel Efficiency", "fuel-efficiency", "Fuel efficiency" -> "fuel-efficiency".
// Also used to compare LayersDefaultSelected names against a layer's own
// layerName, so the two needn't match in case/spacing either.
export function slugifyImageMapName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseCommaList(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map(name => name.trim())
    .filter(name => name.length > 0);
}

// Tolerant JSON-string parse — a malformed value becomes a visible problem
// in that one image map's warning panel instead of crashing the collection.
function parseJsonField<T>(raw: string | null | undefined, field: string, problems: string[]): T | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    problems.push(`${field} is not valid JSON (${(err as Error)?.message ?? err}) and was ignored.`);
    return undefined;
  }
}

export function buildImageMapConfig(node: RawImageMapNode): ImageMapConfig {
  const problems: string[] = [];
  const main = parseJsonField<ImageMapMainLayerSettings>(node.MainLayerSettings, "MainLayerSettings", problems);
  if (!node.MainLayerSettings) {
    problems.push("MainLayerSettings is missing — no base image to show.");
  } else if (main && !main.baseImage?.url) {
    problems.push("MainLayerSettings has no baseImage.url — no base image to show.");
  }

  const rawTooltip = parseJsonField<{ Columns?: number; Layout?: string; DateFormat?: string }>(node.TooltipFormat, "TooltipFormat", problems);
  const tooltip: ImageMapTooltipFormat | undefined = rawTooltip
    ? { columns: rawTooltip.Columns, layout: rawTooltip.Layout ?? undefined, dateFormat: rawTooltip.DateFormat ?? undefined }
    : undefined;

  const layers: ImageMapConfig["layers"] = parseCommaList(node.LayerFileLists).map(
    name => `${IMAGE_MAP_LAYER_FILES_BASE_PATH}/${slugifyImageMapName(name)}.json`
  );
  if (node.LayerAPIURL) {
    layers.push({ source: "api", url: node.LayerAPIURL } as ImageMapDataSource<ImageMapLayerFile[]>);
  }
  const inline = parseJsonField<ImageMapLayerFile[] | ImageMapLayerFile>(node.LayerInlineJSON, "LayerInlineJSON", problems);
  if (inline) {
    layers.push({ source: "inline", value: inline });
  }

  const defaultSelected = parseCommaList(node.LayersDefaultSelected);
  return {
    layerName: main?.layerName,
    // Optional — no title (or a blank one) means no header bar at all.
    title: main?.title?.text?.trim() || undefined,
    baseImage: main?.baseImage ?? { url: "" },
    valueDisplay: main?.valueDisplay,
    labelPosition: main?.labelPosition,
    zoom: main?.zoom,
    imageFit: main?.imageFit,
    autoFitMaxStretch: main?.autoFitMaxStretch,
    showLocationPicker: main?.coordinatePickerEnabled !== false,
    markerStyle: main?.markerStyle,
    layers,
    defaultSelectedLayerNames: defaultSelected.length ? defaultSelected : undefined,
    dataApiUrl: node.DataAPIURL ?? undefined,
    loadDataOnStart: node.LoadDataOnStart === true || node.LoadMetricOnStart === true,
    tooltip,
    configProblems: problems.length ? problems : undefined
  };
}

// Root collection node (7125) -> one config per Configuration entry. Any
// other node is treated as a single image map (no wrapper), same fallback
// nx-map's buildMapCollectionConfig() has.
export function buildImageMapCollection(root: RawImageMapNode | null | undefined): ImageMapConfig[] {
  if (!root) {
    return [];
  }
  const items = root.ComponentType === IMAGE_MAP_COLLECTION_COMPONENT_TYPE ? root.Configuration ?? [] : [root];
  return items.map(buildImageMapConfig);
}
