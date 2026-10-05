import { Component, Inject, OnDestroy } from "@angular/core";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { Subscription } from "rxjs";
import { finalize } from "rxjs/operators";
import { LldGroup, LldView } from "./model/nx-lld.model";
import { apiErrorMessage, NxLldService } from "./services/nx-lld.service";

export interface LldGroupDialogData {
  // Absent -> Add; present -> Edit (same form, pre-filled).
  group?: LldGroup;
  // The view the group belongs to — always the page's selected view.
  view: LldView;
  token: string;
}

// Add/Edit Group popup: the selected view (read-only) and Group Name.
// Saves through NxLldService itself and closes with the saved group.
// Duplicate names (within the view) are checked by the API only; its
// message shows above the buttons and the popup stays open.
@Component({
  selector: "app-nx-lld-group-dialog",
  templateUrl: "./nx-lld-group-dialog.component.html",
  styleUrls: ["./nx-lld-dialog.scss"]
})
export class NxLldGroupDialogComponent implements OnDestroy {
  form: FormGroup;
  saving = false;
  saveError = "";
  private readonly subscriptions = new Subscription();

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: LldGroupDialogData,
    private dialogRef: MatDialogRef<NxLldGroupDialogComponent, LldGroup>,
    private fb: FormBuilder,
    private lldService: NxLldService
  ) {
    this.form = this.fb.group({
      name: [data.group?.name ?? "", Validators.required]
    });
    // A rejected save's message goes away once the user changes anything.
    this.subscriptions.add(this.form.valueChanges.subscribe(() => (this.saveError = "")));
  }

  get isEdit(): boolean {
    return this.data.group?.id != null;
  }

  save(): void {
    if (this.form.invalid || this.saving) {
      this.form.markAllAsTouched();
      return;
    }
    const payload: LldGroup = {
      id: this.data.group?.id ?? null,
      viewId: this.data.view.id!,
      name: this.form.value.name.trim()
    };
    this.saving = true;
    this.saveError = "";
    this.dialogRef.disableClose = true;
    this.lldService
      .saveGroup(payload, this.data.token)
      .pipe(
        finalize(() => {
          this.saving = false;
          this.dialogRef.disableClose = false;
        })
      )
      .subscribe({
        next: saved => this.dialogRef.close(saved),
        error: err => (this.saveError = apiErrorMessage(err))
      });
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }
}
