import { Injectable } from "@angular/core";
import { HttpClient, HttpParams } from "@angular/common/http";
import { Observable, of } from "rxjs";
import { ImageMapDataRecord, ImageMapDataSource, ImageMapParams } from "../model/nx-image-map-model";

// Own copy of nx-map's NXMapConfigService.resolve() — nx-image-map keeps no
// dependency on nx-map (same convention nx-circular-chart follows).
@Injectable()
export class NxImageMapConfigService {
  constructor(private http: HttpClient) {}

  resolve<T>(source: string | ImageMapDataSource<T>): Observable<T> {
    const ds: ImageMapDataSource<T> = typeof source === "string" ? { source: "file", url: source } : source;
    switch (ds.source) {
      case "inline":
        return of(ds.value as T);
      case "file":
      case "api":
        return this.http.get<T>(ds.url as string);
    }
  }

  describe(source: string | ImageMapDataSource<unknown>): string {
    return typeof source === "string" ? source : source.url ?? `${source.source} source`;
  }

  // DataAPIURL with the host's current params as query params (empty values
  // dropped) — same "query string, so a static mock file still answers"
  // pattern nx-map's loadDataOverlay() uses.
  loadData(url: string, params: ImageMapParams | null | undefined): Observable<ImageMapDataRecord[]> {
    return this.http.get<ImageMapDataRecord[]>(url, { params: new HttpParams({ fromObject: toQueryParams(params) }) });
  }
}

export function toQueryParams(params: ImageMapParams | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== null && value !== undefined && value !== "") {
      out[key] = String(value);
    }
  }
  return out;
}
