import * as omanShapeJson from "../../../assets/nx-map/oman-shape.json";
import * as alwustaShapeJson from "../../../assets/nx-map/alwusta-shape.json";
import * as musandamShapeJson from "../../../assets/nx-map/static-layer-1-shape.json";
import * as alBuraymiShapeJson from "../../../assets/nx-map/static-layer-2-shape.json";
import * as alDhahiraShapeJson from "../../../assets/nx-map/static-layer-3-shape.json";
import * as dhofarShapeJson from "../../../assets/nx-map/static-layer-4-shape.json";
import * as adDakhliyahShapeJson from "../../../assets/nx-map/static-layer-5-shape.json";

// Bundled the same way pdo-map-config.json/nx-map-themes.json are — a
// compile-time import, normalized the same way (some TS/bundler
// configurations wrap a JSON import's content under `.default`, some don't).
function json<T>(mod: any): T {
  return (mod.default ?? mod) as T;
}

// Maps each MapConfig's layerName to its shapeData — a fallback ONLY
// consulted when a layer's config doesn't supply its own shapeDataSource at
// all (NXMapAppConfig.shapeDataSource for the base layer,
// StaticLayerRef.shapeDataSource for any other — see
// NXMapConfigService.resolveShapeData()). A config that DOES supply one
// always uses that instead, so this registry never overrides an explicit
// per-deployment shape source — it just saves repeating the same
// file/api DataSource on every layer that already has its shape file
// sitting right here in the codebase. Extend this as more layers are
// added; a layerName with neither an explicit source NOR an entry here
// logs a console.warn instead of silently rendering with no shape/boundary
// at all.
export const SHAPE_DATA_BY_LAYER_NAME: Record<string, any> = {
  // Both keys point at the same bundled shape file — "omanv1" is what the
  // original demo fixture named its base layer, "oman" is what the real
  // upstream payload (real-parent-config.json, COMPONENT_NX_MAP_COLLECTION
  // format) names its own base layer's layerName. Confirmed live: without
  // the "oman" alias, a base layer configured with baseMapType: "shape" and
  // no explicit shapeDataSource never resolves any shapeData at all here,
  // and the whole map silently fails to render — only a console.warn, no
  // thrown error.
  omanv1: json(omanShapeJson),
  oman: json(omanShapeJson),
  alwusta: json(alwustaShapeJson),
  musandam: json(musandamShapeJson),
  "al-buraymi": json(alBuraymiShapeJson),
  "al-dhahira": json(alDhahiraShapeJson),
  dhofar: json(dhofarShapeJson),
  "ad-dakhliyah": json(adDakhliyahShapeJson)
};
