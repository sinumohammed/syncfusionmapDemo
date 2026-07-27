import { CommonModule } from "@angular/common";
import { HttpClientModule } from "@angular/common/http";
import { NgModule } from "@angular/core";
import { MapsModule } from "@syncfusion/ej2-angular-maps";
import { NxMapDemoComponent } from "./nx-map-demo.component";
import { NXMapBuilderService } from "./services/nx-map-builder.service";
import { NXMapConfigService } from "./services/nx-map-config.service";

// Angular 13 predates standalone components, so the demo component is
// declared here instead. Import NxMapDemoModule from your AppModule (or a
// feature module) and drop <app-nx-map-demo></app-nx-map-demo> wherever you
// want the map to render.
@NgModule({
  declarations: [NxMapDemoComponent],
  imports: [CommonModule, MapsModule, HttpClientModule],
  providers: [NXMapBuilderService, NXMapConfigService],
  exports: [NxMapDemoComponent]
})
export class NxMapDemoModule {}
