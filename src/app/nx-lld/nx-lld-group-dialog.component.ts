import { ChangeDetectorRef, Component, Inject, NgZone, OnDestroy } from "@angular/core";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { Subscription } from "rxjs";
import { finalize } from "rxjs/operators";
import { LLD_DEFAULT_GROUP_TYPES, LldGroup, LldGroupType, LldGroupTypeOption, LldView, parseGroupTypes } from "./model/nx-lld.model";
import { apiErrorMessage, NxLldService } from "./services/nx-lld.service";

export interface LldGroupDialogData {
  // Absent -> Add; present -> Edit (same form, pre-filled).
  group?: LldGroup;
  // The view the group belongs to — always the page's selected view.
  view: LldView;
  token: string;
  // The Group Type dropdown: [{ TYPES, TypeID }] (or that as a JSON
  // string); TypeID is saved as GroupType. Default LLD_DEFAULT_GROUP_TYPES.
  groupTypes?: LldGroupType[] | string;
  // What Order starts at for a new group (e.g. after the last one). Default 1.
  nextOrder?: number;
}

// Add/Edit Group popup: the selected view (read-only), Group Name,
// Description, Order, Type and Visible. Saves through NxLldService itself
// (SaveLDGroup) and closes with the saved group. Duplicate names (within
// the view) are checked by the API only; its message shows above the
// buttons and the popup stays open.
@Component({
  selector: "app-nx-lld-group-dialog",
  templateUrl: "./nx-lld-group-dialog.component.html",
  styleUrls: ["./nx-lld-dialog.scss"]
})
export class NxLldGroupDialogComponent implements OnDestroy {
  form: FormGroup;
  readonly typeOptions: LldGroupTypeOption[];
  saving = false;
  saveError = "";
  private readonly subscriptions = new Subscription();

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: LldGroupDialogData,
    private dialogRef: MatDialogRef<NxLldGroupDialogComponent, LldGroup>,
    private fb: FormBuilder,
    private lldService: NxLldService,
    private cdr: ChangeDetectorRef,
    private zone: NgZone
  ) {
    this.typeOptions = parseGroupTypes(data.groupTypes ?? LLD_DEFAULT_GROUP_TYPES);
    const group = data.group;
    this.form = this.fb.group({
      name: [group?.name ?? "", Validators.required],
      description: [group?.description ?? ""],
      order: [group?.order ?? data.nextOrder ?? 1, [Validators.required, Validators.min(0)]],
      // A group's type is fixed once it's created — locked on Edit.
      type: [{ value: group?.type ?? null, disabled: group?.id != null }, Validators.required],
      isVisible: [group?.isVisible ?? true]
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
    // getRawValue(): includes the locked Type on Edit.
    const value = this.form.getRawValue();
    const payload: LldGroup = {
      id: this.data.group?.id ?? null,
      viewId: this.data.view.id!,
      name: value.name.trim(),
      description: (value.description ?? "").trim(),
      order: Number(value.order),
      type: value.type,
      isVisible: !!value.isVisible,
      isDeleted: false
    };
    this.saving = true;
    this.saveError = "";
    this.dialogRef.disableClose = true;
    this.lldService
      .saveGroup(payload, this.data.token)
      .pipe(
        finalize(() =>
          this.refresh(() => {
            this.saving = false;
            this.dialogRef.disableClose = false;
          })
        )
      )
      .subscribe({
        next: saved => this.refresh(() => this.dialogRef.close(saved)),
        error: err => this.refresh(() => (this.saveError = apiErrorMessage(err)))
      });
  }

  // Back in the zone and marked for check, so the result redraws even when
  // the host's HTTP finishes outside the zone.
  private refresh(update: () => void): void {
    this.zone.run(() => {
      update();
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }
}
