import { BrowserModule } from "@angular/platform-browser";
import { BrowserAnimationsModule } from "@angular/platform-browser/animations";
import { NgModule } from "@angular/core";
import { AppComponent } from "./app.component";
import { AppRoutingModule } from "./app-routing.module";
import { NxMapDemoModule } from "./nx-map/nx-map-demo.module";
import { NxCircularChartModule } from "./nx-circular-chart/nx-circular-chart.module";
import { MapDashboardComponent } from "./pages/map-dashboard/map-dashboard.component";
import { TrendDashboardComponent } from "./pages/trend-dashboard/trend-dashboard.component";

@NgModule({
  declarations: [AppComponent, MapDashboardComponent, TrendDashboardComponent],
  // BrowserAnimationsModule is root-only (Angular's animation engine is a
  // single app-wide provider) — the one exception to every other module
  // here being a self-contained per-feature import (NxCircularChartModule
  // itself imports its own HttpClientModule, no shared/global modules
  // otherwise exist). Required by NxCircularChartModule's own MatDialog
  // (nx-circular-chart-comments.component.ts) — without it, Angular
  // Material throws at the first animated component (a dialog's own
  // open/close transition) rather than degrading to no-animation.
  imports: [BrowserModule, BrowserAnimationsModule, AppRoutingModule, NxMapDemoModule, NxCircularChartModule],
  bootstrap: [AppComponent]
})
export class AppModule {}
