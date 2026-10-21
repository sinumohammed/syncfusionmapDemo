import { ChangeDetectorRef, Component, Input, NgZone, OnChanges, OnDestroy, SimpleChanges } from "@angular/core";
import { Observable, of, Subject, Subscription } from "rxjs";
import { catchError, filter, finalize, switchMap } from "rxjs/operators";
import { LLD_VIEW_STATUS_OPTIONS, LldView, LldViewStatus } from "./model/nx-lld.model";
import { apiErrorMessage, LldViewSelection, NxLldService, selectedViewId } from "./services/nx-lld.service";

// The View tab: the picked view's details (GetLDViewDetails) — subsurface,
// stations, description, Private/Public and who created / modified it.
// Gets the pick as the host passes it, {"LDID":[21]}; reloads when that
// view is saved (NxLldService.viewSaved$).
@Component({
  selector: "app-nx-lld-view-details",
  templateUrl: "./nx-lld-view-details.component.html",
  styleUrls: ["./nx-lld-tab.scss", "./nx-lld-view-details.component.scss"]
})
export class NxLldViewDetailsComponent implements OnChanges, OnDestroy {
  // {"LDID":[21]} — a JSON string or the parsed object.
  @Input() viewSelection: string | LldViewSelection | null = null;
  // TODO(host): the logged-in user's API token.
  @Input() token = "";

  readonly ViewStatus = LldViewStatus;
  // How Created on / Modified on are shown.
  readonly auditDateFormat = "dd MMM yyyy, HH:mm";
  viewId: number | null = null;
  details: LldView | null = null;
  loading = false;

  // switchMap drops a still-running fetch for a view that's no longer picked.
  private readonly detailsRequest$ = new Subject<number | null>();
  private readonly subscriptions = new Subscription();

  constructor(private lldService: NxLldService, private cdr: ChangeDetectorRef, private zone: NgZone) {
    this.subscriptions.add(
      this.detailsRequest$
        .pipe(
          switchMap((id: number | null): Observable<LldView | null> => {
            if (id == null) {
              return of(null);
            }
            this.loading = true;
            return this.lldService.getViewDetails(id, this.token).pipe(
              catchError((err: unknown) => {
                console.error("[LLD] GetLDViewDetails failed:", apiErrorMessage(err), err);
                return of<LldView | null>(null);
              }),
              finalize(() => this.refresh(() => (this.loading = false)))
            );
          })
        )
        .subscribe((details: LldView | null) => this.refresh(() => (this.details = details)))
    );
    // This view was just edited — its details may have changed.
    this.subscriptions.add(
      this.lldService.viewSaved$.pipe(filter((id: number | null) => id != null && id === this.viewId)).subscribe(() => this.reload())
    );
  }

  get statusLabel(): string {
    return LLD_VIEW_STATUS_OPTIONS.find(o => o.value === this.details?.status)?.label ?? "";
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["viewSelection"]) {
      const id = selectedViewId(this.viewSelection);
      if (id !== this.viewId) {
        this.viewId = id;
        this.details = null;
        this.reload();
      }
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  private reload(): void {
    this.detailsRequest$.next(this.viewId);
  }

  // Back in the zone and marked for check, so an async result redraws even
  // in an OnPush host or with HTTP finishing outside the zone.
  private refresh(update: () => void): void {
    this.zone.run(() => {
      update();
      this.cdr.markForCheck();
    });
  }
}
