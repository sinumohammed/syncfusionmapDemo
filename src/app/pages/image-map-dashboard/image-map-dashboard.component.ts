import { Component } from "@angular/core";
import * as realImageMapParentConfigJson from "../../nx-image-map/testing/real-image-map-parent-config.json";
import * as coastalTerminalParentConfigJson from "../../nx-image-map/testing/coastal-terminal-parent-config.json";
import { ImageMapMarkerClickEvent, ImageMapParams, RawImageMapNode } from "../../nx-image-map/model/nx-image-map-model";

// Demo page for <app-nx-image-map-collection> — fed the real host payload
// shape (COMPONENT_NX_MAP_IMAGE_COLLECTION), same way MapDashboardComponent
// feeds nx-map its real-parent-config.json. The "Date" input stands in for
// whatever selection a real host page passes down: every change refetches
// DataAPIURL with it as a query param. The "Image" select switches between
// the two sample host payloads — Marine Bunkering (LoadDataOnStart: false,
// so no data until a date is picked) and Coastal Terminal (loads on start).
@Component({
  selector: "app-image-map-dashboard",
  templateUrl: "./image-map-dashboard.component.html",
  styleUrls: ["./image-map-dashboard.component.scss"]
})
export class ImageMapDashboardComponent {
  readonly configs: { name: string; raw: RawImageMapNode }[] = [
    { name: "Coastal Terminal", raw: unwrap(coastalTerminalParentConfigJson) },
    { name: "Marine Bunkering", raw: unwrap(realImageMapParentConfigJson) }
  ];
  selectedConfig = this.configs[0].name;
  rawConfig: RawImageMapNode = this.configs[0].raw;

  get loadsOnStart(): boolean {
    return (this.rawConfig.Configuration ?? [this.rawConfig]).some(c => c.LoadDataOnStart === true);
  }

  selectConfig(): void {
    this.rawConfig = this.configs.find(c => c.name === this.selectedConfig)?.raw ?? this.configs[0].raw;
  }

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

function unwrap(json: unknown): RawImageMapNode {
  return ((json as { default?: unknown }).default ?? json) as RawImageMapNode;
}
