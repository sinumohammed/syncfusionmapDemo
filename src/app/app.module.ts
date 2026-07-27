import { BrowserModule } from "@angular/platform-browser";
import { NgModule } from "@angular/core";
import { AppComponent } from "./app.component";
import { NxMapDemoModule } from "./nx-map/nx-map-demo.module";

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, NxMapDemoModule],
  bootstrap: [AppComponent]
})
export class AppModule {}
