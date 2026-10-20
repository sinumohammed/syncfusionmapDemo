import { NgModule } from "@angular/core";
import { RouterModule, Routes } from "@angular/router";
import { MapDashboardComponent } from "./pages/map-dashboard/map-dashboard.component";
import { TrendDashboardComponent } from "./pages/trend-dashboard/trend-dashboard.component";
import { ImageMapDashboardComponent } from "./pages/image-map-dashboard/image-map-dashboard.component";
import { LldConfigComponent } from "./pages/lld-config/lld-config.component";
import { LldSplitComponent } from "./pages/lld-split/lld-split.component";

// "/" is the app's existing default page (circular chart + map, formerly
// AppComponent's own template — see MapDashboardComponent's own comment);
// "/image-map" is the picture-base-layer marker map (nx-image-map);
// "/lld" is the LLD Configuration screen (nx-lld);
// "/lld-split" is the same LLD split up: View dropdown in a header, Groups /
// Sub-groups in tabs (see LldSplitComponent);
// "/trend" is the new page stacking circular chart on top of the (not yet
// built) bar chart collection — see TrendDashboardComponent. Any unknown
// path falls back to "/" rather than a blank/404 view.
const routes: Routes = [
  { path: "", component: MapDashboardComponent },
  { path: "trend", component: TrendDashboardComponent },
  { path: "image-map", component: ImageMapDashboardComponent },
  { path: "lld", component: LldConfigComponent },
  { path: "lld-split", component: LldSplitComponent },
  { path: "**", redirectTo: "" }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
