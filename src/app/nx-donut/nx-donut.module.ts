import { CommonModule } from "@angular/common";
import { HttpClientModule } from "@angular/common/http";
import { NgModule } from "@angular/core";
import { AccumulationChartModule } from "@syncfusion/ej2-angular-charts";
import { NxDonutComponent } from "./nx-donut.component";
import { NxDonutCollectionComponent } from "./nx-donut-collection.component";
import { NxDonutConfigService } from "./services/nx-donut-config.service";

// Same shape as NxMapDemoModule (Angular 13 predates standalone components):
// import NxDonutModule from your AppModule and drop
// <app-nx-donut-collection></app-nx-donut-collection> wherever the chart
// panel should render (or <app-nx-donut></app-nx-donut> directly for a
// single, unmanaged donut). Shares no module/service with NxMapDemoModule —
// its only Syncfusion dependency is the charts package.
@NgModule({
  declarations: [NxDonutComponent, NxDonutCollectionComponent],
  imports: [CommonModule, AccumulationChartModule, HttpClientModule],
  providers: [NxDonutConfigService],
  exports: [NxDonutComponent, NxDonutCollectionComponent]
})
export class NxDonutModule {}
