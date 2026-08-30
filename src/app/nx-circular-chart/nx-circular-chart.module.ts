import { CommonModule } from "@angular/common";
import { NgModule } from "@angular/core";
import { HttpClientModule } from "@angular/common/http";
import { AccumulationChartModule } from "@syncfusion/ej2-angular-charts";
import { NxCircularChartComponent } from "./nx-circular-chart.component";
import { NxCircularChartCollectionComponent } from "./nx-circular-chart-collection.component";
import { NxCircularChartConfigService } from "./services/nx-circular-chart-config.service";

// Same shape as NxMapDemoModule (Angular 13 predates standalone components):
// import NxCircularChartModule from your AppModule and drop
// <app-nx-circular-chart-collection></app-nx-circular-chart-collection> wherever the chart
// panel should render (or <app-nx-circular-chart></app-nx-circular-chart> directly for a
// single, unmanaged circular chart). Shares no module/service with NxMapDemoModule —
// its only Syncfusion dependency is the charts package, plus
// HttpClientModule/NxCircularChartConfigService (mirrors nx-map's own
// NXMapConfigService split) — NxCircularChartCollectionComponent calls that
// service to fetch its own trend response whenever rawConfig.ApiUrl is set
// (see its own comment); trendResponse stays a plain already-resolved
// @Input otherwise, same as before.
@NgModule({
  declarations: [NxCircularChartComponent, NxCircularChartCollectionComponent],
  imports: [CommonModule, AccumulationChartModule, HttpClientModule],
  providers: [NxCircularChartConfigService],
  exports: [NxCircularChartComponent, NxCircularChartCollectionComponent]
})
export class NxCircularChartModule {}
