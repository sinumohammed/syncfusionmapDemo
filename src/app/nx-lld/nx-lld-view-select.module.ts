import { CommonModule } from "@angular/common";
import { NgModule } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSelectModule } from "@angular/material/select";
import { MatTooltipModule } from "@angular/material/tooltip";
import { NxLldModule } from "./nx-lld.module";
import { NxLldViewSelectComponent } from "./nx-lld-view-select.component";

// The LLD View dropdown on its own, for another module (e.g. the host's
// header module) to import:
//   <app-nx-lld-view-select [hierarchyTags]="tags" [config]="{ showToolbar: true }"
//     (viewChange)="view = $event">
// showToolbar true -> Edit / Delete icons beside it; false -> dropdown only.
// NxLldModule brings the service (shared with the Groups / Sub-groups tabs)
// and the View / confirm popups that Edit and Delete open.
@NgModule({
  declarations: [NxLldViewSelectComponent],
  imports: [CommonModule, MatButtonModule, MatFormFieldModule, MatProgressBarModule, MatSelectModule, MatTooltipModule, NxLldModule],
  exports: [NxLldViewSelectComponent]
})
export class NxLldViewSelectModule {}
