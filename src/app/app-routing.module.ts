import { NgModule } from "@angular/core";
import { RouterModule, Routes } from "@angular/router";
import { MapDashboardComponent } from "./pages/map-dashboard/map-dashboard.component";
import { TrendDashboardComponent } from "./pages/trend-dashboard/trend-dashboard.component";

// "/" is the app's existing default page (circular chart + map, formerly
// AppComponent's own template — see MapDashboardComponent's own comment);
// "/trend" is the new page stacking circular chart on top of the (not yet
// built) bar chart collection — see TrendDashboardComponent. Any unknown
// path falls back to "/" rather than a blank/404 view.
const routes: Routes = [
  { path: "", component: MapDashboardComponent },
  { path: "trend", component: TrendDashboardComponent },
  { path: "**", redirectTo: "" }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
