import { Component, Inject, OnDestroy } from "@angular/core";
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, ValidatorFn, Validators } from "@angular/forms";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { Subscription } from "rxjs";
import { finalize } from "rxjs/operators";
import { LLD_VIEW_STATUS_OPTIONS, LldLookups, LldOption, LldView, LldViewStatus } from "./model/nx-lld.model";
import { NxLldService } from "./services/nx-lld.service";

export interface LldViewDialogData {
  // Absent -> New; present -> Edit (same form, pre-filled).
  view?: LldView;
  lookups: LldLookups;
  // Every OTHER view's name, for the duplicate-name check.
  takenNames: string[];
  token: string;
}

function uniqueNameValidator(takenNames: string[]): ValidatorFn {
  const taken = takenNames.map(n => n.trim().toLowerCase());
  return (control: AbstractControl): ValidationErrors | null =>
    control.value && taken.includes(String(control.value).trim().toLowerCase()) ? { duplicate: true } : null;
}

// New/Edit View popup: View Name, Subsurface, Stations (multi-select of
// that subsurface's own stations), Status, Description. Saves through
// NxLldService itself and closes with the saved view (carrying its server
// id) so the page can select it.
@Component({
  selector: "app-nx-lld-view-dialog",
  templateUrl: "./nx-lld-view-dialog.component.html",
  styleUrls: ["./nx-lld-dialog.scss"]
})
export class NxLldViewDialogComponent implements OnDestroy {
  readonly statusOptions = LLD_VIEW_STATUS_OPTIONS;
  form: FormGroup;
  saving = false;
  saveError = "";
  private subsurfaceChange: Subscription;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: LldViewDialogData,
    private dialogRef: MatDialogRef<NxLldViewDialogComponent, LldView>,
    private fb: FormBuilder,
    private lldService: NxLldService
  ) {
    const view = data.view;
    this.form = this.fb.group({
      name: [view?.name ?? "", [Validators.required, uniqueNameValidator(data.takenNames)]],
      subsurfaceId: [view?.subsurfaceId ?? "", Validators.required],
      stationIds: [view?.stationIds ?? [], Validators.required],
      status: [view?.status ?? LldViewStatus.Private, Validators.required],
      description: [view?.description ?? ""]
    });
    // Stations belong to one subsurface — a different subsurface starts
    // from no selection. Subscribed AFTER the initial values above, so an
    // Edit keeps its saved stations.
    this.subsurfaceChange = this.form.get("subsurfaceId")!.valueChanges.subscribe(() => {
      this.form.get("stationIds")!.setValue([]);
    });
  }

  get isEdit(): boolean {
    return this.data.view?.id != null;
  }

  get stations(): LldOption[] {
    const id = this.form.get("subsurfaceId")!.value;
    return this.data.lookups.subsurfaces.find(s => s.id === id)?.stations ?? [];
  }

  save(): void {
    if (this.form.invalid || this.saving) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.value;
    const payload: LldView = {
      id: this.data.view?.id ?? null,
      name: value.name.trim(),
      subsurfaceId: value.subsurfaceId,
      // Dropdown order, not click order.
      stationIds: this.stations.map(s => s.id).filter(id => value.stationIds.includes(id)),
      status: value.status,
      description: (value.description ?? "").trim()
    };
    this.saving = true;
    this.saveError = "";
    this.dialogRef.disableClose = true;
    this.lldService
      .saveView(payload, this.data.token)
      .pipe(
        finalize(() => {
          this.saving = false;
          this.dialogRef.disableClose = false;
        })
      )
      .subscribe({
        next: saved => this.dialogRef.close(saved),
        error: (err: Error) => (this.saveError = err?.message || "Save failed")
      });
  }

  ngOnDestroy(): void {
    this.subsurfaceChange.unsubscribe();
  }
}
