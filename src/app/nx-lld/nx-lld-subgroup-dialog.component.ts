import { Component, Inject, OnDestroy } from "@angular/core";
import { AbstractControl, FormArray, FormBuilder, FormGroup, ValidationErrors, Validators } from "@angular/forms";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { Subscription } from "rxjs";
import { finalize } from "rxjs/operators";
import {
  LldGroup,
  LldLookups,
  LldOption,
  LldSubGroup,
  LldSubGroupEquipment,
  LldSubGroupType,
  LldTemplate
} from "./model/nx-lld.model";
import { apiErrorMessage, NxLldService } from "./services/nx-lld.service";

export interface LldSubGroupDialogData {
  // Absent -> Add; present -> Edit (same form, pre-filled).
  subGroup?: LldSubGroup;
  // The group the sub-group belongs to.
  group: LldGroup;
  lookups: LldLookups;
  token: string;
}

// Validators.required/minLength skip an empty array, so the "at least one
// equipment" rule needs its own check.
function atLeastOne(control: AbstractControl): ValidationErrors | null {
  return (control as FormArray).length ? null : { required: true };
}

// Add/Edit Sub-group popup: Group (read-only), Type, Template (that type's
// versions), Equipments, Sub-group Name. Each equipment is picked from the
// dropdown, then gets its own Name (pre-filled, editable), Path and
// Attribute.
//
// One sub-group = one template: once the first equipment is added, Type and
// Template lock, so every equipment shares them. They unlock only when every
// equipment has been removed. Saves through NxLldService itself (the API
// re-checks the same rules and rejects duplicate names) and closes with the
// saved sub-group.
@Component({
  selector: "app-nx-lld-subgroup-dialog",
  templateUrl: "./nx-lld-subgroup-dialog.component.html",
  styleUrls: ["./nx-lld-dialog.scss"]
})
export class NxLldSubGroupDialogComponent implements OnDestroy {
  form: FormGroup;
  // The Equipment dropdown's current pick — becomes a row on Add.
  equipmentToAdd: string | null = null;
  saving = false;
  saveError = "";
  private readonly subscriptions = new Subscription();

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: LldSubGroupDialogData,
    private dialogRef: MatDialogRef<NxLldSubGroupDialogComponent, LldSubGroup>,
    private fb: FormBuilder,
    private lldService: NxLldService
  ) {
    const sub = data.subGroup;
    this.form = this.fb.group({
      typeId: [sub?.typeId ?? "", Validators.required],
      templateId: [sub?.templateId ?? "", Validators.required],
      equipments: this.fb.array((sub?.equipments ?? []).map(e => this.equipmentRow(e)), atLeastOne),
      name: [sub?.name ?? "", Validators.required]
    });
    // A template belongs to one type — a different type starts with none.
    this.subscriptions.add(this.form.get("typeId")!.valueChanges.subscribe(() => this.form.get("templateId")!.setValue("")));
    // A rejected save's message goes away once the user changes anything.
    this.subscriptions.add(this.form.valueChanges.subscribe(() => (this.saveError = "")));
    // An Edit with equipments opens already locked.
    this.updateLock();
  }

  get isEdit(): boolean {
    return this.data.subGroup?.id != null;
  }

  get equipments(): FormArray {
    return this.form.get("equipments") as FormArray;
  }

  get equipmentGroups(): FormGroup[] {
    return this.equipments.controls as FormGroup[];
  }

  // Type/Template are disabled while any equipment exists.
  get isLocked(): boolean {
    return this.equipments.length > 0;
  }

  get selectedType(): LldSubGroupType | undefined {
    return this.data.lookups.subGroupTypes.find(t => t.id === this.form.get("typeId")!.value);
  }

  get templates(): LldTemplate[] {
    return this.selectedType?.templates ?? [];
  }

  get selectedTemplate(): LldTemplate | undefined {
    return this.templates.find(t => t.id === this.form.get("templateId")!.value);
  }

  // Equipments not yet in this sub-group — the same one can't go in twice.
  get availableEquipments(): LldOption[] {
    const added = this.equipmentGroups.map(g => g.get("equipmentId")!.value);
    return this.data.lookups.equipments.filter(e => !added.includes(e.id));
  }

  get canAdd(): boolean {
    return !!this.selectedType && !!this.selectedTemplate && !!this.equipmentToAdd;
  }

  templateLabel(t: LldTemplate): string {
    return `${t.name} ${t.version}`;
  }

  equipmentName(id: string): string {
    return this.data.lookups.equipments.find(e => e.id === id)?.name ?? id;
  }

  addEquipment(): void {
    const id = this.equipmentToAdd;
    if (!this.canAdd || !this.availableEquipments.some(e => e.id === id)) {
      return;
    }
    this.equipments.push(this.equipmentRow({ equipmentId: id!, name: this.equipmentName(id!), path: "", attribute: "" }));
    this.equipmentToAdd = null;
    this.updateLock();
  }

  removeEquipment(index: number): void {
    this.equipments.removeAt(index);
    this.equipments.markAsTouched();
    this.updateLock();
  }

  save(): void {
    if (this.form.invalid || this.saving) {
      this.form.markAllAsTouched();
      return;
    }
    // getRawValue(): Type/Template are disabled (locked) by now, and
    // disabled controls are left out of `form.value`.
    const value = this.form.getRawValue();
    const payload: LldSubGroup = {
      id: this.data.subGroup?.id ?? null,
      groupId: this.data.group.id!,
      name: value.name.trim(),
      typeId: value.typeId,
      templateId: value.templateId,
      equipments: (value.equipments as LldSubGroupEquipment[]).map(e => ({
        equipmentId: e.equipmentId,
        name: e.name.trim(),
        path: (e.path ?? "").trim(),
        attribute: (e.attribute ?? "").trim()
      }))
    };
    this.saving = true;
    this.saveError = "";
    this.dialogRef.disableClose = true;
    this.lldService
      .saveSubGroup(payload, this.data.token)
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

  private equipmentRow(e: LldSubGroupEquipment): FormGroup {
    return this.fb.group({
      equipmentId: [e.equipmentId],
      name: [e.name, Validators.required],
      path: [e.path ?? ""],
      attribute: [e.attribute ?? ""]
    });
  }

  private updateLock(): void {
    for (const name of ["typeId", "templateId"]) {
      const control = this.form.get(name)!;
      if (this.isLocked) {
        control.disable({ emitEvent: false });
      } else {
        control.enable({ emitEvent: false });
      }
    }
  }
}
