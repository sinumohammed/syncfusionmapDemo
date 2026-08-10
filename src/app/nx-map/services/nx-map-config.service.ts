import { Injectable } from "@angular/core";
import { HttpClient, HttpParams } from "@angular/common/http";
import { forkJoin, Observable, of } from "rxjs";
import { map } from "rxjs/operators";
import { SHAPE_DATA_BY_LAYER_NAME } from "./shape-data-registry";
import { DataSource, MapGroup } from "../model/nx-map-model";
import { SubLayerApiConfig } from "../model/nx-map-app-config";

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

  // Resolves a layer's shapeData with the bundled registry as a fallback:
  // an explicit `source` (NXMapAppConfig.shapeDataSource for the base layer,
  // StaticLayerRef.shapeDataSource for any other) always wins when
  // provided — this only falls back to
  // SHAPE_DATA_BY_LAYER_NAME, keyed by `layerName`, when the config omits a
  // source entirely. A layerName with neither logs a warning and resolves
  // to undefined rather than throwing — the layer still builds, just with
  // no shapeData (no boundary/shape drawn for it).
  resolveShapeData(layerName: string, source?: DataSource<any>): Observable<any> {
    if (source) {
      return this.resolve(source);
    }
    const fallback = SHAPE_DATA_BY_LAYER_NAME[layerName];
    if (!fallback) {
      console.warn(
        `[NXMap] No shapeDataSource configured for layer "${layerName}", and no fallback found in SHAPE_DATA_BY_LAYER_NAME — this layer will have no shape/boundary.`
      );
    }
    return of(fallback);
  }

  // Fetches (or RE-fetches) one sub-layer API endpoint's groups. `payload`
  // is sent as query params — a plain flat object of string/number/boolean
  // values, e.g. { region: "north" } — so the same static-asset-backed mock
  // used in dev keeps working (a static file server only understands GET;
  // it ignores the query string but still serves the file). Swapping to a
  // POST body (`this.http.post(api.url, payload)`) is a one-line change
  // here if a real backend needs a richer/nested payload instead.
  //
  // The response may be one MapGroup or MapGroup[] (single vs multiple
  // groups from the same call) — normalized and flattened, with
  // api.heading filled in only for groups that didn't set their own.
  //
  // Call this again later (e.g. from a filter/search action elsewhere in
  // the host app) with a different payload to swap in a different set of
  // groups for the same endpoint — see NxMapDemoComponent.reloadSubLayerGroups(),
  // which replaces rather than appends to whatever this returned last time.
  loadSubLayerGroup(api: SubLayerApiConfig, payload?: Record<string, string | number | boolean>): Observable<MapGroup[]> {
    const params = payload ? new HttpParams({ fromObject: payload }) : undefined;
    return this.http.get<MapGroup | MapGroup[]>(api.url, { params }).pipe(
      map(res => (Array.isArray(res) ? res : [res]).map(g => ({ ...g, heading: g.heading ?? api.heading })))
    );
  }

  // Initial-load helper: fetches every configured endpoint (typically just
  // one) via loadSubLayerGroup() and flattens them into a single list.
  loadSubLayerGroups(apis: SubLayerApiConfig[]): Observable<MapGroup[]> {
    if (!apis.length) {
      return of([]);
    }
    return forkJoin(apis.map(api => this.loadSubLayerGroup(api))).pipe(map(results => results.flat()));
  }
}
