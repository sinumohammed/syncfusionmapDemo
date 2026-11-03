import { ChangeDetectorRef, Component, Inject, NgZone, OnDestroy } from "@angular/core";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { of, Subscription } from "rxjs";
import { finalize, switchMap } from "rxjs/operators";
import { groupTypeId, LLD_SUBGROUP_DUMMY, LldGroup, LldSeries, LldSeriesSubGroup } from "./model/nx-lld.model";
import { apiErrorMessage, NxLldService } from "./services/nx-lld.service";

export interface LldSeriesSubGroupDialogData {
  // Absent -> Add; present -> Edit (same form, pre-filled).
  subGroup?: LldSeriesSubGroup;
  // The group the sub-group belongs to — shown, not editable. Its type's
  // name and Id (for GetLDSeries) come from the cached GetLDGroupTypes.
  group: LldGroup;
  token: string;
}

// Add/Edit Sub-group popup of the split Sub-groups tab: Group and Group
// Type (read-only), the group type's Series (GetLDSeries, checkboxes), then
// Type, that type's Equipment and Capacity.
// TODO(host): Type and Equipment are placeholders (LLD_SUBGROUP_DUMMY);
// saves to the mock only.
@Component({
  selector: "app-nx-lld-series-subgroup-dialog",
  templateUrl: "./nx-lld-series-subgroup-dialog.component.html",
  styleUrls: ["./nx-lld-dialog.scss"]
})
export class NxLldSeriesSubGroupDialogComponent implements OnDestroy {
  readonly dummy = LLD_SUBGROUP_DUMMY;
  form: FormGroup;
  groupTypeName = "";
  // GetLDGroupTypes' Id for the group's type; null = no type / not in the
  // list, so no series to pick.
  groupTypeId: number | null = null;
  series: LldSeries[] = [];
  // Only a loaded list may replace the saved series — a failed load keeps
  // them as they were.
  seriesLoaded = false;
  seriesLoading = true;
  seriesError = "";
  // Picked series ids — kept outside the form, the list arrives later.
  readonly selectedSeries = new Set<number>();
  saving = false;
  saveError = "";
  private readonly subscriptions = new Subscription();

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: LldSeriesSubGroupDialogData,
    private dialogRef: MatDialogRef<NxLldSeriesSubGroupDialogComponent, LldSeriesSubGroup>,
    private fb: FormBuilder,
    private lldService: NxLldService,
    private cdr: ChangeDetectorRef,
    private zone: NgZone
  ) {
    const sub = data.subGroup;
    (sub?.seriesIds ?? []).forEach(id => this.selectedSeries.add(id));
    this.form = this.fb.group({
      sourceType: [sub?.sourceType ?? LLD_SUBGROUP_DUMMY.types[0].id],
      equipmentId: [sub?.equipmentId ?? null],
      capacity: [sub?.capacity ?? null, Validators.min(0)]
    });
    // A new Type clears an Equipment that isn't one of its own.
    this.subscriptions.add(
      this.form.get("sourceType")!.valueChanges.subscribe(() => {
        const equipment = this.form.get("equipmentId")!;
        if (!this.equipments.some(e => e.id === equipment.value)) {
          equipment.setValue(null);
        }
      })
    );
    this.subscriptions.add(this.form.valueChanges.subscribe(() => (this.saveError = "")));
    this.loadSeries();
  }

  get isEdit(): boolean {
    return this.data.subGroup?.id != null;
  }

  // The picked Type's equipments.
  get equipments(): { id: number; name: string }[] {
    const type = this.form.get("sourceType")!.value;
    return LLD_SUBGROUP_DUMMY.equipments.filter(e => e.typeId === type);
  }

  toggleSeries(id: number, checked: boolean): void {
    if (checked) {
      this.selectedSeries.add(id);
    } else {
      this.selectedSeries.delete(id);
    }
    this.saveError = "";
  }

  save(): void {
    if (this.form.invalid || this.saving) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const payload: LldSeriesSubGroup = {
      id: this.data.subGroup?.id ?? null,
      groupId: this.data.group.id!,
      // In the list's order; ids no longer offered for this type are dropped.
      seriesIds: this.seriesLoaded
        ? this.series.filter(s => this.selectedSeries.has(s.id)).map(s => s.id)
        : this.data.subGroup?.seriesIds ?? [],
      sourceType: value.sourceType,
      equipmentId: value.equipmentId,
      capacity: value.capacity === null || value.capacity === "" ? null : Number(value.capacity)
    };
    this.saving = true;
    this.saveError = "";
    this.dialogRef.disableClose = true;
    this.lldService
      .saveSeriesSubGroup(payload, this.data.token)
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

  // The group's type (cached GetLDGroupTypes), then its series.
  private loadSeries(): void {
    const token = this.data.token;
    this.subscriptions.add(
      this.lldService
        .getGroupTypes(token)
        .pipe(
          switchMap(options => {
            const type = this.data.group.type;
            this.groupTypeName = type == null ? "" : options.find(o => o.value === Number(type))?.label ?? String(type);
            this.groupTypeId = groupTypeId(type, options);
            return this.groupTypeId == null ? of(null as LldSeries[] | null) : this.lldService.getSeries(this.groupTypeId, token);
          }),
          finalize(() => this.refresh(() => (this.seriesLoading = false)))
        )
        .subscribe({
          next: series =>
            this.refresh(() => {
              this.series = series ?? [];
              this.seriesLoaded = series != null;
            }),
          error: (err: unknown) => this.refresh(() => (this.seriesError = apiErrorMessage(err)))
        })
    );
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
