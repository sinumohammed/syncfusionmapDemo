import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable } from "rxjs";
import { TrendNode } from "../model/nx-circular-chart-model";

// Same split as nx-map's own NXMapConfigService — NxCircularChartCollectionComponent
// stays free of HttpClient itself, this service owns the one live fetch it
// needs (RawCircularChartCollectionNode.ApiUrl, see its own comment).
@Injectable()
export class NxCircularChartConfigService {
  constructor(private http: HttpClient) {}

  fetchTrendResponse(url: string): Observable<TrendNode[]> {
    return this.http.get<TrendNode[]>(url);
  }
}
