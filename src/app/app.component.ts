import { Component } from "@angular/core";
import * as realParentConfigJson from "./nx-map/testing/real-parent-config.json";
import { RawLayerNode, buildMapCollectionConfig } from "./nx-map/services/parent-config-transform";
import { MapCollectionConfig, MapCircularChartSelection } from "./nx-map/model/nx-map-model";
import * as realCircularChartParentConfigJson from "./nx-circular-chart/testing/real-circular-chart-parent-config.json";
import * as trendResponseJson from "../assets/mock-api/trend-response.json";
import { CircularChartSelectionEvent, RawCircularChartCollectionNode, TrendGroup } from "./nx-circular-chart/model/nx-circular-chart-model";

// Standalone-demo stand-in for a real host application binding its own
// widget payloads onto NxCircularChartCollectionComponent's `rawConfig`/
// `trendResponse` @Input()s and NxMapCollectionComponent's `config` @Input —
// neither component bundles a
// default of its own, so something has to supply both for the demo to show
// anything when run on its own. This is also the shared parent container the
// two independent components sit side by side in: circular chart panel on the left,
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
  // real-circular-chart-parent-config.json is the upstream widget-payload shape (root
  // = COMPONENT_NXCIRCULAR_COLLECTION, Configuration[] = one
  // COMPONENT_NXCIRCULAR_CHART per circular chart) — passed straight through to
  // NxCircularChartCollectionComponent's own `rawConfig` input, which runs the
  // Name-vs-TrendName matching itself (see parent-circular-chart-config-transform.ts).
  // Bundled statically here purely as this demo's stand-in for whatever a
  // real host fetches its widget config from.
  circularChartRawConfig = ((realCircularChartParentConfigJson as any).default ?? realCircularChartParentConfigJson) as RawCircularChartCollectionNode;
  // trend-response.json stands in for a live trend API's own response — a
  // SEPARATE input from circularChartRawConfig above (see
  // NxCircularChartCollectionComponent's own comment for why), bundled statically
  // for the same reason.
  circularChartTrendResponse = ((trendResponseJson as any).default ?? trendResponseJson) as TrendGroup[];

  // Bound straight onto <app-nx-map-collection>'s own circularChartSelection @Input
  // in the template (see app.component.html) — this is the only point of
  // contact between the circular chart side and the map side; neither imports the
  // other. Reassigning this field (rather than reaching into the map side
  // through a @ViewChild and calling a method on it) is what actually
  // triggers NxMapCollectionComponent's/NxMapDemoComponent's own
  // ngOnChanges, same as `mapCollectionConfig`/`circularChartCollectionConfig`
  // above already do for their own @Input bindings.
  circularChartSelection: MapCircularChartSelection | null = null;

  // Forwards a circular chart card's selection to every map in the collection —
  // CircularChartSelectionEvent and MapCircularChartSelection are independent types that
  // just happen to share the same shape (see MapCircularChartSelection's own
  // comment), so no mapping/casting is needed here.
  onSublayersSelected(selection: CircularChartSelectionEvent): void {
    this.circularChartSelection = selection;
  }
}
