import { CommonModule } from "@angular/common";
import { NgModule } from "@angular/core";
import { NxLldViewSelectModule } from "../../nx-lld/nx-lld-view-select.module";
import { LldHeaderComponent } from "./lld-header.component";

// The demo's stand-in for the host's header module — shows the View
// dropdown being used from another module via NxLldViewSelectModule.
@NgModule({
  declarations: [LldHeaderComponent],
  imports: [CommonModule, NxLldViewSelectModule],
  exports: [LldHeaderComponent]
})
export class LldHeaderModule {}
