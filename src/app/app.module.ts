import { BrowserModule } from "@angular/platform-browser";
import { NgModule } from "@angular/core";
import { AppComponent } from "./app.component";
import { NxMapDemoModule } from "./nx-map/nx-map-demo.module";
import { NxDonutModule } from "./nx-donut/nx-donut.module";

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, NxMapDemoModule, NxDonutModule],
  bootstrap: [AppComponent]
})
export class AppModule {}
