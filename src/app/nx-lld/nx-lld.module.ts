import { CommonModule } from "@angular/common";
import { HttpClientModule } from "@angular/common/http";
import { NgModule } from "@angular/core";
import { NxLldConfigComponent } from "./nx-lld-config.component";
import { NxLldService } from "./services/nx-lld.service";

// Self-contained like the other nx-* modules: import NxLldModule and drop
// <app-nx-lld-config></app-nx-lld-config> where the LLD screen should render.
@NgModule({
  declarations: [NxLldConfigComponent],
  imports: [CommonModule, HttpClientModule],
  providers: [NxLldService],
  exports: [NxLldConfigComponent]
})
export class NxLldModule {}
