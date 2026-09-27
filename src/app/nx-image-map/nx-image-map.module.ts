import { CommonModule } from "@angular/common";
import { HttpClientModule } from "@angular/common/http";
import { NgModule } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { NxImageMapComponent } from "./nx-image-map.component";
import { NxImageMapCollectionComponent } from "./nx-image-map-collection.component";
import { NxImageMapConfigService } from "./services/nx-image-map-config.service";

// Self-contained like NxMapDemoModule/NxCircularChartModule — no Syncfusion,
// no dependency on nx-map. Drop <app-nx-image-map-collection [rawConfig]="...">
// (the host's raw COMPONENT_NX_MAP_IMAGE_COLLECTION node) anywhere.
@NgModule({
  declarations: [NxImageMapComponent, NxImageMapCollectionComponent],
  imports: [CommonModule, FormsModule, HttpClientModule],
  providers: [NxImageMapConfigService],
  exports: [NxImageMapComponent, NxImageMapCollectionComponent]
})
export class NxImageMapModule {}
