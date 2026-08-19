import { CommonModule } from "@angular/common";
import { NgModule } from "@angular/core";
import { AccumulationChartModule } from "@syncfusion/ej2-angular-charts";
import { NxCircularChartComponent } from "./nx-circular-chart.component";
import { NxCircularChartCollectionComponent } from "./nx-circular-chart-collection.component";

// Same shape as NxMapDemoModule (Angular 13 predates standalone components):
// import NxCircularChartModule from your AppModule and drop
// <app-nx-circular-chart-collection></app-nx-circular-chart-collection> wherever the chart
// panel should render (or <app-nx-circular-chart></app-nx-circular-chart> directly for a
// single, unmanaged circular chart). Shares no module/service with NxMapDemoModule —
// its only Syncfusion dependency is the charts package. No HttpClientModule/
// config service — NxCircularChartCollectionComponent takes its rawConfig/
// trendResponse inputs already-resolved (see its own comment); fetching
// either one live is the host's own concern.
@NgModule({
  declarations: [NxCircularChartComponent, NxCircularChartCollectionComponent],
  imports: [CommonModule, AccumulationChartModule],
  exports: [NxCircularChartComponent, NxCircularChartCollectionComponent]
})
export class NxCircularChartModule {}
