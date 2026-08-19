import { CommonModule } from "@angular/common";
import { HttpClientModule } from "@angular/common/http";
import { NgModule } from "@angular/core";
import { MapsModule } from "@syncfusion/ej2-angular-maps";
import { NxMapDemoComponent } from "./nx-map-demo.component";
import { NxMapCollectionComponent } from "./nx-map-collection.component";
import { NXMapBuilderService } from "./services/nx-map-builder.service";
import { NXMapConfigService } from "./services/nx-map-config.service";

// Angular 13 predates standalone components, so both components are
// declared here instead. Import NxMapDemoModule from your AppModule (or a
// feature module) and drop <app-nx-map-collection></app-nx-map-collection>
// wherever you want a config-driven set of maps to render (or
// <app-nx-map-demo></app-nx-map-demo> directly for a single, unmanaged map —
// NxMapCollectionComponent is just a thin *ngFor loop over it, same
// relationship as NxCircularChartCollectionComponent/NxCircularChartComponent).
@NgModule({
  declarations: [NxMapDemoComponent, NxMapCollectionComponent],
  imports: [CommonModule, MapsModule, HttpClientModule],
  providers: [NXMapBuilderService, NXMapConfigService],
  exports: [NxMapDemoComponent, NxMapCollectionComponent]
})
export class NxMapDemoModule {}
