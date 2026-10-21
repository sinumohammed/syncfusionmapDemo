import { ChangeDetectorRef, Component, Inject, NgZone, OnDestroy } from "@angular/core";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { isObservable, Observable, of, Subject, Subscription } from "rxjs";
import { catchError, finalize, switchMap } from "rxjs/operators";
import { dcTag } from "./model/dc-tag.model";
import { LLD_VIEW_STATUS_OPTIONS, LldView, LldViewStatus } from "./model/nx-lld.model";
import { apiErrorMessage, findSubsurface, NxLldService } from "./services/nx-lld.service";

export interface LldViewDialogData {
  // Absent -> New; present -> Edit (same form, pre-filled).
  view?: LldView;
  // The Subsurface dropdown: already loaded, or the call that loads it —
  // then the popup opens at once and shows a loader in that field.
  subsurfaces: dcTag[] | Observable<dcTag[]>;
  token: string;
}

// New/Edit View popup: View Name, Subsurface, Stations (multi-select of
// that subsurface's own stations, fetched when it's picked), Status,
// Description. Saves through
// NxLldService itself and closes with the saved view so the page can
// select it. Duplicate names are checked by the API
// only (it also sees views this screen doesn't list); its message shows
// above the buttons and the popup stays open.
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
  subsurfaces: dcTag[] = [];
  subsurfacesLoading = false;
  subsurfacesError = "";
  // The picked subsurface's stations — empty until its fetch lands.
  stations: dcTag[] = [];
  stationsLoading = false;
  stationsError = "";
  // Each push fetches that subsurface's stations; switchMap drops a
  // still-running fetch for a subsurface that's no longer picked.
  private readonly stationsRequest$ = new Subject<string | null>();
  private readonly subscriptions = new Subscription();

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: LldViewDialogData,
    private dialogRef: MatDialogRef<NxLldViewDialogComponent, LldView>,
    private fb: FormBuilder,
    private lldService: NxLldService,
    private cdr: ChangeDetectorRef,
    private zone: NgZone
  ) {
    const view = data.view;
    this.form = this.fb.group({
      name: [view?.name ?? "", Validators.required],
      subsurfaceName: [null, Validators.required],
      stationNames: [view?.stationNames ?? [], Validators.required],
      status: [view?.status ?? LldViewStatus.Private, Validators.required],
      description: [view?.description ?? ""]
    });
    this.subscriptions.add(
      this.stationsRequest$
        .pipe(
          switchMap((name: string | null): Observable<dcTag[]> => {
            const subsurface = this.subsurfaceByName(name);
            this.stations = [];
            this.stationsError = "";
            this.setStationsLoading(!!subsurface);
            return subsurface
              ? this.lldService.getStations(subsurface, this.data.token).pipe(
                  catchError(err => {
                    this.refresh(() => (this.stationsError = apiErrorMessage(err)));
                    return of<dcTag[]>([]);
                  })
                )
              : of<dcTag[]>([]);
          })
        )
        .subscribe((stations: dcTag[]) =>
          this.refresh(() => {
            this.stations = stations;
            this.setStationsLoading(false);
          })
        )
    );
    // Stations belong to one subsurface — a user picking a different one
    // starts from no selection. (The preselect in setSubsurfaces() doesn't
    // go through here, so an Edit keeps its saved stations.)
    this.subscriptions.add(
      this.form.get("subsurfaceName")!.valueChanges.subscribe((name: string | null) => {
        this.form.get("stationNames")!.setValue([]);
        this.stationsRequest$.next(name);
      })
    );
    if (isObservable(data.subsurfaces)) {
      this.subsurfacesLoading = true;
      this.form.get("subsurfaceName")!.disable({ emitEvent: false });
      this.subscriptions.add(
        data.subsurfaces.subscribe({
          next: (subsurfaces: dcTag[]) => this.refresh(() => this.setSubsurfaces(subsurfaces)),
          error: (err: unknown) =>
            this.refresh(() => {
              this.subsurfacesError = apiErrorMessage(err);
              this.setSubsurfaces([]);
            })
        })
      );
    } else {
      this.setSubsurfaces(data.subsurfaces);
    }
    // A rejected save's message goes away once the user changes anything.
    this.subscriptions.add(this.form.valueChanges.subscribe(() => (this.saveError = "")));
  }

  // The Subsurface dropdown is keyed by name (TagName — unique), since the
  // API sends SubSurfaceOperationId back as 0. An edit preselects the
  // view's saved name, written exactly as the dropdown has it, and loads
  // its stations.
  private setSubsurfaces(subsurfaces: dcTag[]): void {
    this.subsurfaces = subsurfaces;
    this.subsurfacesLoading = false;
    const control = this.form.get("subsurfaceName")!;
    control.enable({ emitEvent: false });
    const name = this.subsurfaceByName(this.data.view?.subsurfaceName ?? null)?.TagName ?? null;
    if (name) {
      control.setValue(name, { emitEvent: false });
      this.stationsRequest$.next(name);
    }
  }

  // The Stations field is locked while its list loads (keeping any
  // selection).
  private setStationsLoading(loading: boolean): void {
    this.stationsLoading = loading;
    const control = this.form.get("stationNames")!;
    if (loading) {
      control.disable({ emitEvent: false });
    } else {
      control.enable({ emitEvent: false });
    }
  }

  private subsurfaceByName(name: string | null): dcTag | undefined {
    return findSubsurface(this.subsurfaces, name);
  }

  // Back in the zone and marked for check, so an async result redraws even
  // when the host's HTTP finishes outside the zone.
  private refresh(update: () => void): void {
    this.zone.run(() => {
      update();
      this.cdr.markForCheck();
    });
  }

  get isEdit(): boolean {
    return this.data.view?.id != null;
  }

  save(): void {
    // Not while a list is loading — the payload below is filtered through
    // the stations, so an early save would drop the selection.
    if (this.form.invalid || this.saving || this.stationsLoading || this.subsurfacesLoading) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.value;
    // Saved as before: the picked tag's ObjectID and TagName.
    const subsurface = this.subsurfaceByName(value.subsurfaceName);
    const payload: LldView = {
      id: this.data.view?.id ?? null,
      name: value.name.trim(),
      subsurfaceId: subsurface?.ObjectID ?? null,
      subsurfaceName: subsurface?.TagName ?? "",
      // Dropdown order, not click order.
      stationNames: this.stations.map(s => s.TagName ?? "").filter(name => value.stationNames.includes(name)),
      status: value.status,
      description: (value.description ?? "").trim(),
      createdBy: this.data.view?.createdBy
    };
    this.saving = true;
    this.saveError = "";
    this.dialogRef.disableClose = true;
    this.lldService
      .saveView(payload, this.data.token)
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

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }
}
