import { CommonModule } from "@angular/common";
import { NgModule } from "@angular/core";
import { HttpClientModule } from "@angular/common/http";
import { ReactiveFormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatDatepickerModule } from "@angular/material/datepicker";
import { MatDialogModule } from "@angular/material/dialog";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatNativeDateModule } from "@angular/material/core";
import { MatRadioModule } from "@angular/material/radio";
import { MatSelectModule } from "@angular/material/select";
import { AgGridModule } from "ag-grid-angular";
import { AccumulationChartModule } from "@syncfusion/ej2-angular-charts";
import { NxCircularChartComponent } from "./nx-circular-chart.component";
import { NxCircularChartCollectionComponent } from "./nx-circular-chart-collection.component";
import { NxCircularChartCommentsComponent } from "./nx-circular-chart-comments.component";
import { NxCircularChartCommentsActionCellComponent } from "./nx-circular-chart-comments-action-cell.component";
import { NxCircularChartConfigService } from "./services/nx-circular-chart-config.service";
import { NxCircularChartCommentsService } from "./services/nx-circular-chart-comments.service";

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
//
// Material/ag-grid modules below are needed ONLY by
// NxCircularChartCommentsComponent (its own "+" dialog/history grid) — kept
// here rather than a separate module since nothing else in this repo shares
// them yet (no shared/common module exists — see that component's own
// header comment). BrowserAnimationsModule itself stays out of this list;
// it's root-scoped (app.module.ts), the one exception to every dependency
// here being self-contained per this feature module.
@NgModule({
  declarations: [
    NxCircularChartComponent,
    NxCircularChartCollectionComponent,
    NxCircularChartCommentsComponent,
    NxCircularChartCommentsActionCellComponent
  ],
  imports: [
    CommonModule,
    AccumulationChartModule,
    HttpClientModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatNativeDateModule,
    MatRadioModule,
    MatSelectModule,
    AgGridModule
  ],
  providers: [NxCircularChartConfigService, NxCircularChartCommentsService],
  exports: [NxCircularChartComponent, NxCircularChartCollectionComponent]
})
export class NxCircularChartModule {}
