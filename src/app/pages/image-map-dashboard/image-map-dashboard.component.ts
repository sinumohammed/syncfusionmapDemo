import { Component } from "@angular/core";
import * as realImageMapParentConfigJson from "../../nx-image-map/testing/real-image-map-parent-config.json";
import { ImageMapMarkerClickEvent, ImageMapParams, RawImageMapNode } from "../../nx-image-map/model/nx-image-map-model";

// Demo page for <app-nx-image-map-collection> — fed the real host payload
// shape (COMPONENT_NX_MAP_IMAGE_COLLECTION), same way MapDashboardComponent
// feeds nx-map its real-parent-config.json. The "Date" input stands in for
// whatever selection a real host page passes down: every change refetches
// DataAPIURL with it as a query param. That config has LoadDataOnStart:
// false, so no data loads until a date is picked.
@Component({
  selector: "app-image-map-dashboard",
  templateUrl: "./image-map-dashboard.component.html",
  styleUrls: ["./image-map-dashboard.component.scss"]
})
export class ImageMapDashboardComponent {
  readonly rawConfig = ((realImageMapParentConfigJson as any).default ?? realImageMapParentConfigJson) as RawImageMapNode;

  date = "";
  params: ImageMapParams = {};
  lastClick = "";

  applyParams(): void {
    this.params = { date: this.date || null };
  }

  onMarkerClick(e: ImageMapMarkerClickEvent): void {
    this.lastClick = `${e.name} (${e.id}) — ${e.records.length} reading(s)`;
  }
}
