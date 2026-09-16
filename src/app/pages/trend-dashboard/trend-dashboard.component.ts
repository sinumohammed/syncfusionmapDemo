import { Component } from "@angular/core";
import * as realCircularChartParentConfigJson from "../../nx-circular-chart/testing/real-circular-chart-parent-config.json";
import { RawCircularChartCollectionNode } from "../../nx-circular-chart/model/nx-circular-chart-model";

// New route ("/trend") stacking the circular chart collection on top of a
// (not yet built) bar chart collection — see this component's own template
// for the placeholder standing in for that second collection until its own
// config/component pair exists (same approach nx-circular-chart itself
// will be mirrored into, per the plan discussed with the user: a sibling
// nx-bar-chart module/collection, same rawConfig-in/collection-renders-out
// shape). Deliberately its own page/route, not a second pane bolted onto
// MapDashboardComponent's existing layout — this dashboard has no map at
// all, just the two stacked trend collections.
@Component({
  selector: "app-trend-dashboard",
  templateUrl: "./trend-dashboard.component.html",
  styleUrls: ["./trend-dashboard.component.scss"]
})
export class TrendDashboardComponent {
  // Same bundled test config MapDashboardComponent uses for its own
  // circular chart pane — this page has no separate config of its own yet,
  // just a second place the same collection renders.
  circularChartRawConfig = ((realCircularChartParentConfigJson as any).default ?? realCircularChartParentConfigJson) as RawCircularChartCollectionNode;
}
