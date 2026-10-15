import { Component, Inject, OnDestroy } from "@angular/core";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { Observable, of, Subject, Subscription } from "rxjs";
import { catchError, finalize, switchMap } from "rxjs/operators";
import { dcTag } from "./model/dc-tag.model";
import { LLD_VIEW_STATUS_OPTIONS, LldView, LldViewStatus } from "./model/nx-lld.model";
import { apiErrorMessage, NxLldService } from "./services/nx-lld.service";

export interface LldViewDialogData {
  // Absent -> New; present -> Edit (same form, pre-filled).
  view?: LldView;
  // The Subsurface dropdown, already loaded by the page.
  subsurfaces: dcTag[];
  // The logged-in user — sent as CreatedBy / ModifiedBy.
  currentUser: string;
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
    private lldService: NxLldService
  ) {
    const view = data.view;
    const subsurfaceName = this.findSubsurfaceName(view);
    this.form = this.fb.group({
      name: [view?.name ?? "", Validators.required],
      subsurfaceName: [subsurfaceName, Validators.required],
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
            this.stationsLoading = !!subsurface;
            return subsurface
              ? this.lldService.getStations(subsurface, this.data.token).pipe(
                  catchError(err => {
                    this.stationsError = apiErrorMessage(err);
                    return of<dcTag[]>([]);
                  })
                )
              : of<dcTag[]>([]);
          })
        )
        .subscribe((stations: dcTag[]) => {
          this.stations = stations;
          this.stationsLoading = false;
        })
    );
    // Stations belong to one subsurface — a different subsurface starts
    // from no selection. Subscribed AFTER the initial values above, so an
    // Edit keeps its saved stations (loaded just below).
    this.subscriptions.add(
      this.form.get("subsurfaceName")!.valueChanges.subscribe((name: string | null) => {
        this.form.get("stationNames")!.setValue([]);
        this.stationsRequest$.next(name);
      })
    );
    if (subsurfaceName) {
      this.stationsRequest$.next(subsurfaceName);
    }
    // A rejected save's message goes away once the user changes anything.
    this.subscriptions.add(this.form.valueChanges.subscribe(() => (this.saveError = "")));
  }

  // The Subsurface dropdown is keyed by name (TagName — unique), since the
  // API sends SubSurfaceOperationId back as 0. An edit preselects the
  // view's saved name, written exactly as the dropdown has it.
  private findSubsurfaceName(view: LldView | undefined): string | null {
    return this.subsurfaceByName(view?.subsurfaceName ?? null)?.TagName ?? null;
  }

  // Ignores case and surrounding spaces.
  private subsurfaceByName(name: string | null): dcTag | undefined {
    const key = (name ?? "").trim().toLowerCase();
    return key ? this.data.subsurfaces.find((s: dcTag) => (s.TagName ?? "").trim().toLowerCase() === key) : undefined;
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
      .saveView(payload, this.data.currentUser, this.data.token)
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
