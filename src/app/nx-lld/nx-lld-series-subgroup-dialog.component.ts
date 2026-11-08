import { ChangeDetectorRef, Component, Inject, NgZone, OnDestroy } from "@angular/core";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { combineLatest, Observable, of, Subject, Subscription } from "rxjs";
import { catchError, finalize, map, switchMap } from "rxjs/operators";
import {
  groupTypeId,
  LldEquipment,
  LldEquipmentDetails,
  LldGroup,
  LldGroupTypeOption,
  LldSeries,
  LldSeriesSubGroup
} from "./model/nx-lld.model";
import { apiErrorMessage, NxLldService } from "./services/nx-lld.service";

export interface LldSeriesSubGroupDialogData {
  // Absent -> Add; present -> Edit (same form, pre-filled, Group locked).
  subGroup?: LldSeriesSubGroup;
  // The view's groups — the Group Name dropdown.
  groups: LldGroup[];
  // Pre-selected group: the tab's pick (null under All).
  groupId: number | null;
  // The view's stations — shown as chips, not selectable.
  stationNames: string[];
  token: string;
}

// What a group brings once picked: its equipment (GetEquipmentByGroupId)
// and its type's series (GetLDSeries).
interface LldGroupLists {
  equipments: LldEquipment[];
  series: LldSeries[];
  error: string;
}

// A details fetch's answer — `fill` is false for Edit's first load, which
// keeps the saved values and only needs the telemetry / paths.
interface LldDetailsResult {
  details: LldEquipmentDetails | null;
  fill: boolean;
  error: string;
}

// UC-06 "LD - Sub-group Configuration": Group Name (pre-selected from the
// tab), Equipment Type (the group's, read-only), the view's Stations
// (chips, view only), Equipment, then — once an equipment is picked —
// Capacity and Series, filled from the equipment's details
// (getEquipmentDetails()) and still editable:
// - Capacity: the value only, the unit shown beside it. Auto (toggle):
//   the value is applied with the field's own Save button.
// - Series: Manual = one of the group type's series (radio buttons);
//   Auto = the telemetry's series.
// - With Auto on, each shows the Element / Attribute path it's read from.
// TODO(host): saves to the mock only; the details API is a guess.
@Component({
  selector: "app-nx-lld-series-subgroup-dialog",
  templateUrl: "./nx-lld-series-subgroup-dialog.component.html",
  styleUrls: ["./nx-lld-dialog.scss"]
})
export class NxLldSeriesSubGroupDialogComponent implements OnDestroy {
  form: FormGroup;
  typeOptions: LldGroupTypeOption[] = [];
  equipments: LldEquipment[] = [];
  series: LldSeries[] = [];
  listsLoading = false;
  listsError = "";
  details: LldEquipmentDetails | null = null;
  detailsLoading = false;
  detailsError = "";
  capacityUnit: string;
  // Auto capacity: the value applied with its Save button — what's saved.
  appliedCapacity: number | null = null;
  saving = false;
  saveError = "";
  private readonly groupChange$ = new Subject<number | null>();
  private readonly equipmentChange$ = new Subject<{ equipmentId: number | null; fill: boolean }>();
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
    this.capacityUnit = sub?.capacityUnit ?? "";
    this.appliedCapacity = sub?.capacityAuto ? sub.capacity : null;
    this.form = this.fb.group({
      groupId: [{ value: sub?.groupId ?? data.groupId ?? null, disabled: sub?.id != null }, Validators.required],
      equipmentId: [sub?.equipmentId ?? null, Validators.required],
      capacityAuto: [sub?.capacityAuto ?? false],
      capacity: [sub?.capacity ?? null, [Validators.required, Validators.min(0)]],
      seriesAuto: [sub?.seriesAuto ?? false],
      seriesId: [sub?.seriesId ?? null]
    });
    this.subscriptions.add(this.form.valueChanges.subscribe(() => (this.saveError = "")));
    // A new group: its equipment and series replace the old picks.
    this.subscriptions.add(
      this.form.get("groupId")!.valueChanges.subscribe(id => {
        this.form.patchValue({ equipmentId: null }, { emitEvent: false });
        this.clearDetailFields();
        this.equipmentChange$.next({ equipmentId: null, fill: true });
        this.groupChange$.next(id);
      })
    );
    // A new equipment: its details fill Capacity and Series.
    this.subscriptions.add(
      this.form.get("equipmentId")!.valueChanges.subscribe(equipmentId => {
        // Blank, not the last equipment's values, if its details fail.
        this.clearDetailFields();
        this.equipmentChange$.next({ equipmentId, fill: true });
      })
    );
    this.subscriptions.add(this.form.get("seriesAuto")!.valueChanges.subscribe(() => this.updateSeriesValidator()));
    this.updateSeriesValidator();
    // switchMap: the latest pick wins over a still-loading one.
    this.subscriptions.add(
      combineLatest([this.lldService.getGroupTypes(data.token).pipe(catchError(() => of<LldGroupTypeOption[]>([]))), this.groupChange$])
        .pipe(switchMap(([types, groupId]) => this.loadLists(types, groupId)))
        .subscribe(lists =>
          this.refresh(() => {
            this.equipments = lists.equipments;
            this.series = lists.series;
            this.listsError = lists.error;
          })
        )
    );
    this.subscriptions.add(
      this.equipmentChange$
        .pipe(switchMap(change => this.loadDetails(change.equipmentId, change.fill)))
        .subscribe(result => this.refresh(() => this.applyDetails(result)))
    );
    this.groupChange$.next(this.form.get("groupId")!.value);
    // Edit: the saved equipment's telemetry / paths, the saved values kept.
    this.equipmentChange$.next({ equipmentId: sub?.equipmentId ?? null, fill: false });
  }

  get isEdit(): boolean {
    return this.data.subGroup?.id != null;
  }

  get group(): LldGroup | undefined {
    const id = this.form.get("groupId")!.value;
    return this.data.groups.find(g => g.id === id);
  }

  get hasEquipment(): boolean {
    return this.form.get("equipmentId")!.value != null;
  }

  get equipmentTypeName(): string {
    const type = this.group?.type;
    if (type == null) {
      return "";
    }
    return this.typeOptions.find(o => o.value === Number(type))?.label ?? String(type);
  }

  get capacityAuto(): boolean {
    return !!this.form.get("capacityAuto")!.value;
  }

  get seriesAuto(): boolean {
    return !!this.form.get("seriesAuto")!.value;
  }

  // Auto series: the telemetry's, from the equipment's details — or, on
  // Edit when they didn't load, the saved Auto series.
  get automatedSeries(): LldSeries | null {
    const sub = this.data.subGroup;
    const saved = sub?.seriesAuto && sub.equipmentId === this.form.get("equipmentId")!.value ? sub.seriesId : null;
    const id = this.details ? this.details.seriesId : saved;
    return id == null ? null : this.series.find(s => s.id === id) ?? { id, name: String(id), color: "" };
  }

  // Auto capacity typed but not applied with its Save button yet.
  get capacityPending(): boolean {
    return this.capacityAuto && this.toNumber(this.form.get("capacity")!.value) !== this.appliedCapacity;
  }

  applyCapacity(): void {
    const control = this.form.get("capacity")!;
    if (control.invalid) {
      control.markAsTouched();
      return;
    }
    this.appliedCapacity = this.toNumber(control.value);
  }

  save(): void {
    if (this.form.invalid || this.saving) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.capacityPending) {
      this.saveError = "Save the Auto capacity first.";
      return;
    }
    const value = this.form.getRawValue();
    const seriesId = value.seriesAuto ? this.automatedSeries?.id ?? null : value.seriesId;
    if (seriesId == null) {
      this.saveError = "No series to save — pick one, or switch Auto off.";
      return;
    }
    const payload: LldSeriesSubGroup = {
      id: this.data.subGroup?.id ?? null,
      groupId: value.groupId,
      equipmentId: value.equipmentId,
      equipmentName: this.equipments.find(e => e.id === value.equipmentId)?.name ?? this.data.subGroup?.equipmentName ?? "",
      capacity: value.capacityAuto ? this.appliedCapacity : this.toNumber(value.capacity),
      capacityUnit: this.capacityUnit,
      capacityAuto: !!value.capacityAuto,
      seriesId,
      seriesAuto: !!value.seriesAuto
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

  // The picked group's equipment and its type's series, together.
  private loadLists(types: LldGroupTypeOption[], groupId: number | null): Observable<LldGroupLists> {
    this.typeOptions = types;
    const group = this.data.groups.find(g => g.id === groupId);
    if (!group) {
      return of({ equipments: [], series: [], error: "" });
    }
    const typeId = groupTypeId(group.type, types);
    this.refresh(() => (this.listsLoading = true));
    return combineLatest([
      this.lldService.getEquipments(group.id!, this.data.token),
      typeId == null ? of<LldSeries[]>([]) : this.lldService.getSeries(typeId, this.data.token)
    ]).pipe(
      map(([equipments, series]): LldGroupLists => ({ equipments, series, error: "" })),
      catchError((err: unknown) => of<LldGroupLists>({ equipments: [], series: [], error: apiErrorMessage(err) })),
      finalize(() => this.refresh(() => (this.listsLoading = false)))
    );
  }

  private loadDetails(equipmentId: number | null, fill: boolean): Observable<LldDetailsResult> {
    const groupId = this.form.get("groupId")!.value;
    if (equipmentId == null || groupId == null) {
      return of({ details: null, fill, error: "" });
    }
    this.refresh(() => (this.detailsLoading = true));
    return this.lldService.getEquipmentDetails(groupId, equipmentId, this.data.token).pipe(
      map((details): LldDetailsResult => ({ details, fill, error: "" })),
      catchError((err: unknown) => of<LldDetailsResult>({ details: null, fill, error: apiErrorMessage(err) })),
      finalize(() => this.refresh(() => (this.detailsLoading = false)))
    );
  }

  // A picked equipment's details fill Capacity and Series (Edit's first
  // load keeps the saved values).
  private applyDetails(result: LldDetailsResult): void {
    this.details = result.details;
    this.detailsError = result.error;
    const d = result.details;
    if (!d) {
      return;
    }
    if (result.fill) {
      this.form.patchValue({
        capacityAuto: d.capacityAuto,
        capacity: d.capacity,
        seriesAuto: d.seriesAuto,
        seriesId: d.seriesId
      });
      // From the API, so already "saved".
      this.appliedCapacity = d.capacityAuto ? d.capacity : null;
      this.capacityUnit = d.capacityUnit;
    } else if (!this.capacityUnit) {
      this.capacityUnit = d.capacityUnit;
    }
  }

  // Capacity / Series back to empty Manual — a new equipment's details
  // fill them in again.
  private clearDetailFields(): void {
    this.details = null;
    this.detailsError = "";
    this.appliedCapacity = null;
    this.capacityUnit = "";
    this.form.patchValue({ capacityAuto: false, capacity: null, seriesAuto: false, seriesId: null }, { emitEvent: false });
    this.updateSeriesValidator();
  }

  // Series is required only when picked by hand.
  private updateSeriesValidator(): void {
    const control = this.form.get("seriesId")!;
    control.setValidators(this.seriesAuto ? null : Validators.required);
    control.updateValueAndValidity({ emitEvent: false });
  }

  private toNumber(value: unknown): number | null {
    return value === null || value === undefined || value === "" ? null : Number(value);
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
