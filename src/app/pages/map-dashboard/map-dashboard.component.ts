import { Component } from "@angular/core";
import * as realParentConfigJson from "../../nx-map/testing/real-parent-config.json";
import { RawLayerNode, buildMapCollectionConfig } from "../../nx-map/services/parent-config-transform";
import { MapCollectionConfig, MapCircularChartSelection } from "../../nx-map/model/nx-map-model";
import * as realCircularChartParentConfigJson from "../../nx-circular-chart/testing/real-circular-chart-parent-config.json";
import { CircularChartSelectionEvent, RawCircularChartCollectionNode } from "../../nx-circular-chart/model/nx-circular-chart-model";

// Formerly AppComponent's own body — moved here unchanged (see
// AppComponent's own comment for why a page needs this) once AppComponent
// itself became just the router shell (nav + <router-outlet>, see
// app.component.html), so this route ("/", the app's default/current page)
// keeps showing exactly what AppComponent used to render directly: the
// circular chart panel side by side with the map collection.
@Component({
  selector: "app-map-dashboard",
  templateUrl: "./map-dashboard.component.html",
  styleUrls: ["./map-dashboard.component.scss"]
})
export class MapDashboardComponent {
  mapCollectionConfig: MapCollectionConfig<RawLayerNode> = buildMapCollectionConfig(
    ((realParentConfigJson as any).default ?? realParentConfigJson) as RawLayerNode
  );
  circularChartRawConfig = ((realCircularChartParentConfigJson as any).default ?? realCircularChartParentConfigJson) as RawCircularChartCollectionNode;

  circularChartSelection: MapCircularChartSelection | null = null;

  onSublayersSelected(selection: CircularChartSelectionEvent): void {
    this.circularChartSelection = selection;
  }
}
