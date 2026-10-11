import { Component, Inject, OnDestroy } from "@angular/core";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { of, Subject, Subscription } from "rxjs";
import { catchError, finalize, switchMap } from "rxjs/operators";
import { dcTag } from "./model/dc-tag.model";
import { LLD_VIEW_STATUS_OPTIONS, LldView, LldViewStatus } from "./model/nx-lld.model";
import { apiErrorMessage, NxLldService } from "./services/nx-lld.service";

export interface LldViewDialogData {
  // Absent -> New; present -> Edit (same form, pre-filled).
  view?: LldView;
  // The Subsurface dropdown, already loaded by the page.
  subsurfaces: dcTag[];
  token: string;
}

// New/Edit View popup: View Name, Subsurface, Stations (multi-select of
// that subsurface's own stations, fetched when it's picked), Status,
// Description. Saves through
// NxLldService itself and closes with the saved view (carrying its server
// id) so the page can select it. Duplicate names are checked by the API
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
  // The picked subsurface's stations — empty until its fetch lands.
  stations: dcTag[] = [];
  stationsLoading = false;
  stationsError = "";
  // Each push fetches that subsurface's stations; switchMap drops a
  // still-running fetch for a subsurface that's no longer picked.
  private readonly stationsRequest$ = new Subject<number | null>();
  private readonly subscriptions = new Subscription();

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: LldViewDialogData,
    private dialogRef: MatDialogRef<NxLldViewDialogComponent, LldView>,
    private fb: FormBuilder,
    private lldService: NxLldService
  ) {
    const view = data.view;
    this.form = this.fb.group({
      name: [view?.name ?? "", Validators.required],
      subsurfaceId: [view?.subsurfaceId ?? null, Validators.required],
      stationIds: [view?.stationIds ?? [], Validators.required],
      status: [view?.status ?? LldViewStatus.Private, Validators.required],
      description: [view?.description ?? ""]
    });
    this.subscriptions.add(
      this.stationsRequest$
        .pipe(
          switchMap(id => {
            const subsurface = this.data.subsurfaces.find(s => s.ObjectID === id);
            this.stations = [];
            this.stationsError = "";
            this.stationsLoading = !!subsurface;
            return subsurface
              ? this.lldService.getStations(subsurface, this.data.token).pipe(
                  catchError(err => {
                    this.stationsError = apiErrorMessage(err);
                    return of([]);
                  })
                )
              : of([]);
          })
        )
        .subscribe(stations => {
          this.stations = stations;
          this.stationsLoading = false;
        })
    );
    // Stations belong to one subsurface — a different subsurface starts
    // from no selection. Subscribed AFTER the initial values above, so an
    // Edit keeps its saved stations (loaded just below).
    this.subscriptions.add(
      this.form.get("subsurfaceId")!.valueChanges.subscribe(id => {
        this.form.get("stationIds")!.setValue([]);
        this.stationsRequest$.next(id);
      })
    );
    if (view?.subsurfaceId != null) {
      this.stationsRequest$.next(view.subsurfaceId);
    }
    // A rejected save's message goes away once the user changes anything.
    this.subscriptions.add(this.form.valueChanges.subscribe(() => (this.saveError = "")));
  }

  get isEdit(): boolean {
    return this.data.view?.id != null;
  }

  save(): void {
    // Not while stations are loading — the payload below is filtered
    // through them, so an early save would drop the selection.
    if (this.form.invalid || this.saving || this.stationsLoading) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.value;
    const payload: LldView = {
      id: this.data.view?.id ?? null,
      name: value.name.trim(),
      subsurfaceId: value.subsurfaceId,
      // Dropdown order, not click order.
      stationIds: this.stations.map(s => s.ObjectID!).filter(id => value.stationIds.includes(id)),
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
        error: err => (this.saveError = apiErrorMessage(err))
      });
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }
}
