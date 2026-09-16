import { BrowserModule } from "@angular/platform-browser";
import { NgModule } from "@angular/core";
import { AppComponent } from "./app.component";
import { AppRoutingModule } from "./app-routing.module";
import { NxMapDemoModule } from "./nx-map/nx-map-demo.module";
import { NxCircularChartModule } from "./nx-circular-chart/nx-circular-chart.module";
import { MapDashboardComponent } from "./pages/map-dashboard/map-dashboard.component";
import { TrendDashboardComponent } from "./pages/trend-dashboard/trend-dashboard.component";

@NgModule({
  declarations: [AppComponent, MapDashboardComponent, TrendDashboardComponent],
  imports: [BrowserModule, AppRoutingModule, NxMapDemoModule, NxCircularChartModule],
  bootstrap: [AppComponent]
})
export class AppModule {}
