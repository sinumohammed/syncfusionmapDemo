import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable, of } from "rxjs";
import { DonutDataSource } from "../model/nx-donut-model";

// Mirrors nx-map's NXMapConfigService.resolve() in shape only — kept as its
// own independent service (not imported from nx-map) per this component's
// "shares nothing with nx-map" design. "file" and "api" both resolve via
// HttpClient.get, kept as separate discriminants only for readability/intent
// at the call site.
@Injectable()
export class NxDonutConfigService {
  constructor(private http: HttpClient) {}

  resolve<T>(source: DonutDataSource<T>): Observable<T> {
    switch (source.source) {
      case "inline":
        return of(source.value as T);
      case "file":
      case "api":
        return this.http.get<T>(source.url as string);
    }
  }
}
