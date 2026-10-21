import { ChangeDetectorRef, Component, Input, NgZone, OnChanges, OnDestroy, SimpleChanges } from "@angular/core";
import { Observable, of, Subject, Subscription } from "rxjs";
import { catchError, finalize, switchMap } from "rxjs/operators";
import { LLD_VIEW_STATUS_OPTIONS, LldView, LldViewStatus } from "./model/nx-lld.model";
import { apiErrorMessage, NxLldService } from "./services/nx-lld.service";

// The View tab: the given view's details (GetLDViewDetails) — subsurface,
// stations, description, Private/Public and who created / modified it.
// Takes the view picked in the header's View dropdown as input; until its
// details arrive (or if that call fails) it shows the dropdown's own row.
@Component({
  selector: "app-nx-lld-view-details",
  templateUrl: "./nx-lld-view-details.component.html",
  styleUrls: ["./nx-lld-tab.scss", "./nx-lld-view-details.component.scss"]
})
export class NxLldViewDetailsComponent implements OnChanges, OnDestroy {
  @Input() view: LldView | null = null;
  // TODO(host): the logged-in user's API token.
  @Input() token = "";

  readonly ViewStatus = LldViewStatus;
  // How Created on / Modified on are shown.
  readonly auditDateFormat = "dd MMM yyyy, HH:mm";
  details: LldView | null = null;
  loading = false;

  // switchMap drops a still-running fetch for a view that's no longer picked.
  private readonly detailsRequest$ = new Subject<number | null>();
  private readonly detailsSub: Subscription;

  constructor(private lldService: NxLldService, private cdr: ChangeDetectorRef, private zone: NgZone) {
    this.detailsSub = this.detailsRequest$
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
      .subscribe((details: LldView | null) => this.refresh(() => (this.details = details)));
  }

  // The details when they're for the current view, else its dropdown row.
  get shown(): LldView | null {
    return this.details && this.details.id === this.view?.id ? this.details : this.view;
  }

  get statusLabel(): string {
    return LLD_VIEW_STATUS_OPTIONS.find(o => o.value === this.shown?.status)?.label ?? "";
  }

  // Any new view object reloads — a different view, or the same one sent
  // again after an edit (its details may have changed).
  ngOnChanges(changes: SimpleChanges): void {
    if (changes["view"]) {
      this.details = null;
      this.detailsRequest$.next(this.view?.id ?? null);
    }
  }

  ngOnDestroy(): void {
    this.detailsSub.unsubscribe();
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
