import { CommonModule } from "@angular/common";
import { HttpClientModule } from "@angular/common/http";
import { NgModule } from "@angular/core";
import { ReactiveFormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatDialogModule } from "@angular/material/dialog";
import { MatExpansionModule } from "@angular/material/expansion";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSelectModule } from "@angular/material/select";
import { MatTabsModule } from "@angular/material/tabs";
import { MatTooltipModule } from "@angular/material/tooltip";
import { NxLldConfigComponent } from "./nx-lld-config.component";
import { NxLldConfirmDialogComponent } from "./nx-lld-confirm-dialog.component";
import { NxLldGroupDialogComponent } from "./nx-lld-group-dialog.component";
import { NxLldGroupsComponent } from "./nx-lld-groups.component";
import { NxLldSubGroupDialogComponent } from "./nx-lld-subgroup-dialog.component";
import { NxLldSubGroupsComponent } from "./nx-lld-subgroups.component";
import { NxLldViewDialogComponent } from "./nx-lld-view-dialog.component";
import { NxLldService } from "./services/nx-lld.service";

// Self-contained like the other nx-* modules: import NxLldModule and drop
// <app-nx-lld-config></app-nx-lld-config> where the LLD screen should render.
// Or the split version: the View dropdown from NxLldViewSelectModule in the
// host's header, and <app-nx-lld-groups> / <app-nx-lld-subgroups> (in tabs)
// taking its picked view.
// Needs BrowserAnimationsModule at the root for its Material dialogs.
@NgModule({
  declarations: [
    NxLldConfigComponent,
    NxLldConfirmDialogComponent,
    NxLldViewDialogComponent,
    NxLldGroupDialogComponent,
    NxLldSubGroupDialogComponent,
    NxLldGroupsComponent,
    NxLldSubGroupsComponent
  ],
  imports: [
    CommonModule,
    HttpClientModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTabsModule,
    MatTooltipModule
  ],
  providers: [NxLldService],
  // MatTabsModule too, for the host page that puts the Groups / Sub-groups
  // components in tabs.
  exports: [NxLldConfigComponent, NxLldGroupsComponent, NxLldSubGroupsComponent, MatTabsModule]
})
export class NxLldModule {}
