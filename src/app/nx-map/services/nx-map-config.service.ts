import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable, of } from "rxjs";
import { catchError, map } from "rxjs/operators";
import { DataSource, LayerFileEnvelope } from "../model/nx-map-model";
import { LAYER_FILES_BASE_PATH, slugifyLayerFileName } from "./parent-config-transform";

@Injectable()
export class NXMapConfigService {
  constructor(private http: HttpClient) {}

  // "file" and "api" both resolve via HttpClient.get — kept as separate
  // discriminants only for readability/intent at the call site (a file
  // source could later gain caching, an api source retry/auth headers,
  // without touching "inline").
  resolve<T>(source: DataSource<T>): Observable<T> {
    switch (source.source) {
      case "inline":
        return of(source.value as T);
      case "file":
      case "api":
        return this.http.get<T>(source.url as string);
    }
  }

  // Resolves the BASE layer's own shapeData purely by its `layerName` —
  // fetches assets/nx-map/layers/<slug(layerName)>.json (the same
  // convention/folder LayerFileLists uses) and reads its `.shapeData`. Any
  // other layer carries its own shapeData directly in its own
  // LayerFileEnvelope (see LayerFileLists/LayerAPIURL/LayerInlineConfig in
  // parent-config-transform.ts) and never calls this. A missing file is a
  // loud console.error (not a throw) — the base layer still builds, just
  // with no shapeData (no boundary/shape drawn for it).
  resolveShapeData(layerName: string): Observable<any> {
    const url = `${LAYER_FILES_BASE_PATH}/${slugifyLayerFileName(layerName)}.json`;
    return this.http.get<LayerFileEnvelope>(url).pipe(
      map(envelope => envelope.shapeData),
      catchError(() => {
        console.error(
          `[NXMap] No shape file found for layer "${layerName}" at "${url}" — this layer will have no shape/boundary.`
        );
        return of(undefined);
      })
    );
  }
}
