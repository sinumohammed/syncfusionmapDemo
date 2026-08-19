import { BrowserModule } from "@angular/platform-browser";
import { NgModule } from "@angular/core";
import { AppComponent } from "./app.component";
import { NxMapDemoModule } from "./nx-map/nx-map-demo.module";
import { NxCircularChartModule } from "./nx-circular-chart/nx-circular-chart.module";

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, NxMapDemoModule, NxCircularChartModule],
  bootstrap: [AppComponent]
})
export class AppModule {}
