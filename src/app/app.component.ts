import { Component, ViewChild } from "@angular/core";
import * as realParentConfigJson from "./nx-map/testing/real-parent-config.json";
import { RawLayerNode, buildMapCollectionConfig } from "./nx-map/services/parent-config-transform";
import { NxMapCollectionComponent } from "./nx-map/nx-map-collection.component";
import { MapCollectionConfig } from "./nx-map/model/nx-map-model";
import * as donutCollectionJson from "./nx-donut/config/nx-donut-charts.json";
import { DonutCollectionConfig, DonutSelectionEvent } from "./nx-donut/model/nx-donut-model";

// Standalone-demo stand-in for a real host application binding its own
// widget payloads onto NxDonutCollectionComponent's `config` @Input and
// NxMapCollectionComponent's `config` @Input — neither component bundles a
// default of its own, so something has to supply both for the demo to show
// anything when run on its own. This is also the shared parent container the
// two independent components sit side by side in: donut panel on the left,
// map collection on the right.
@Component({
  selector: "app-root",
  templateUrl: "./app.component.html",
  styleUrls: ["./app.component.scss"]
})
export class AppComponent {
  // real-parent-config.json's own top-level node IS the collection wrapper
  // now (ComponentType 7119 / COMPONENT_NX_MAP_COLLECTION) — its
  // Configuration[] is one RawLayerNode per map, so buildMapCollectionConfig()
  // reads that directly rather than this component wrapping a single config
  // itself. NxMapCollectionComponent renders one <app-nx-map-demo> per
  // resolved entry, so the real payload growing/shrinking that array is
  // reflected with zero template/component change here.
  mapCollectionConfig: MapCollectionConfig<RawLayerNode> = buildMapCollectionConfig(
    ((realParentConfigJson as any).default ?? realParentConfigJson) as RawLayerNode
  );
  donutCollectionConfig = ((donutCollectionJson as any).default ?? donutCollectionJson) as DonutCollectionConfig;

  @ViewChild("mapCollectionRef") private mapCollectionRef?: NxMapCollectionComponent;

  // Forwards a donut card's selection to every map in the collection — see
  // NxMapCollectionComponent.applyDonutSelection(). This is the only point
  // of contact between the donut side and the map side; neither imports the
  // other.
  onSublayersSelected(selection: DonutSelectionEvent): void {
    this.mapCollectionRef?.applyDonutSelection(selection.selectedId, selection.allIds, selection.slices);
  }
}
