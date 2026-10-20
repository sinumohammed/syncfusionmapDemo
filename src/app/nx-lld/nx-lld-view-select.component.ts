import { Component, DoCheck, EventEmitter, Input, OnDestroy, Output } from "@angular/core";
import { MatDialog } from "@angular/material/dialog";
import { asapScheduler, forkJoin, Observable, of, Subject, Subscription } from "rxjs";
import { catchError, finalize, map, observeOn, switchMap } from "rxjs/operators";
import { LldView } from "./model/nx-lld.model";
import { dcTag } from "./model/dc-tag.model";
import { apiErrorMessage, hierarchyKey, NxLldService } from "./services/nx-lld.service";
import { LldViewDialogData, NxLldViewDialogComponent } from "./nx-lld-view-dialog.component";
import { LldConfirmDialogData, NxLldConfirmDialogComponent } from "./nx-lld-confirm-dialog.component";

// What the host can switch on the dropdown.
export interface LldViewSelectConfig {
  // true -> Edit and Delete icons beside the dropdown; false -> the list only.
  showToolbar: boolean;
}

// A views reload: which view to select once the list arrives — by id, or
// by name when the save didn't report one.
interface LldViewsRequest {
  selectId: number | null;
  selectName?: string;
}

// The View dropdown on its own, for the host's header. Only lists the
// hierarchy's views (GetLDViews) and says which one is picked
// (viewChange) — the Groups / Sub-groups tabs take that view as input.
// Edit fetches the view's details (GetLDViewDetails) and opens the View
// popup; Delete asks first. Both only when config.showToolbar is on.
@Component({
  selector: "app-nx-lld-view-select",
  templateUrl: "./nx-lld-view-select.component.html",
  styleUrls: ["./nx-lld-view-select.component.scss"]
})
export class NxLldViewSelectComponent implements DoCheck, OnDestroy {
  // The host's current hierarchy selection — any change (new array or
  // in-place edit) reloads the list.
  @Input() hierarchyTags: dcTag[] | null = null;
  // Sent as a saved view's CreatedBy / ModifiedBy.
  @Input() currentUser: string | null = null;
  // TODO(host): the logged-in user's API token.
  @Input() token = "";
  @Input() config: LldViewSelectConfig = { showToolbar: true };
  // The picked view (its list row), or null when there's none.
  @Output() readonly viewChange = new EventEmitter<LldView | null>();

  views: LldView[] = [];
  selectedViewId: number | null = null;
  // Set while Edit fetches details + subsurfaces, so a double-click can't
  // open two popups.
  editLoading = false;

  private pendingRequests = 0;
  get isLoading(): boolean {
    return this.pendingRequests > 0;
  }

  get selectedView(): LldView | null {
    return this.views.find(v => v.id === this.selectedViewId) ?? null;
  }

  // switchMap drops a still-running fetch when the hierarchy changes or a
  // save/delete reloads. observeOn(asap): a cached list replays
  // synchronously, and ngDoCheck must not emit viewChange mid change
  // detection.
  private readonly viewsRequest$ = new Subject<LldViewsRequest>();
  private readonly viewsSub: Subscription;
  private loadedHierarchyKey: string | null = null;
  private emittedView: LldView | null = null;

  constructor(private lldService: NxLldService, private dialog: MatDialog) {
    this.viewsSub = this.viewsRequest$
      .pipe(
        switchMap(({ selectId, selectName }: LldViewsRequest) => {
          const tags: dcTag[] = this.hierarchyTags ?? [];
          const views$: Observable<LldView[]> = tags.length
            ? this.track(this.lldService.getViews(tags, this.token)).pipe(
                catchError((err: unknown) => {
                  console.error("[LLD] GetLDViews failed:", apiErrorMessage(err), err);
                  return of<LldView[]>([]);
                })
              )
            : of<LldView[]>([]);
          return views$.pipe(
            map((views: LldView[]) => ({
              views,
              selectId: selectId ?? views.find((v: LldView) => v.name === selectName)?.id ?? null
            }))
          );
        }),
        observeOn(asapScheduler)
      )
      .subscribe(({ views, selectId }) => this.setViews(views, selectId));
  }

  ngDoCheck(): void {
    const key = hierarchyKey(this.hierarchyTags);
    if (key !== this.loadedHierarchyKey) {
      this.loadedHierarchyKey = key;
      this.selectedViewId = null;
      this.reloadViews(null);
    }
  }

  ngOnDestroy(): void {
    this.viewsSub.unsubscribe();
  }

  onSelectionChange(): void {
    this.emitSelected();
  }

  editView(): void {
    const view = this.selectedView;
    if (!view || view.id == null || this.editLoading) {
      return;
    }
    // The popup's Subsurface dropdown needs the hierarchy's subsurfaces
    // (cached per hierarchy in the service).
    this.editLoading = true;
    forkJoin([this.lldService.getViewDetails(view.id, this.token), this.lldService.getSubsurfaces(this.hierarchyTags ?? [], this.token)])
      .pipe(finalize(() => (this.editLoading = false)))
      .subscribe({
        next: ([details, subsurfaces]: [LldView, dcTag[]]) => this.openViewDialog(details, subsurfaces),
        error: (err: unknown) => console.error("[LLD] Edit view: loading details failed:", apiErrorMessage(err), err)
      });
  }

  deleteView(): void {
    const view = this.selectedView;
    if (!view || view.id == null) {
      return;
    }
    this.dialog
      .open<NxLldConfirmDialogComponent, LldConfirmDialogData, boolean>(NxLldConfirmDialogComponent, {
        data: {
          title: "Delete View",
          message: `Delete view "${view.name}"? All its groups, sub-groups and equipments will be deleted too.`
        }
      })
      .afterClosed()
      .subscribe(confirmed => {
        if (confirmed) {
          this.track(this.lldService.deleteView(view.id!, this.token)).subscribe(() => this.reloadViews(null));
        }
      });
  }

  private openViewDialog(view: LldView, subsurfaces: dcTag[]): void {
    this.dialog
      .open<NxLldViewDialogComponent, LldViewDialogData, LldView>(NxLldViewDialogComponent, {
        width: "420px",
        data: { view, subsurfaces, currentUser: this.currentUser ?? "", token: this.token }
      })
      .afterClosed()
      .subscribe(saved => {
        if (saved) {
          this.reloadViews(saved.id ?? null, saved.name);
        }
      });
  }

  private reloadViews(selectId: number | null, selectName?: string): void {
    this.viewsRequest$.next({ selectId, selectName });
  }

  // Selects `selectId`, else keeps the current view, else the first one.
  private setViews(views: LldView[], selectId: number | null): void {
    this.views = views;
    const keep = [selectId, this.selectedViewId].find(id => id != null && views.some(v => v.id === id));
    this.selectedViewId = keep ?? views[0]?.id ?? null;
    this.emitSelected();
  }

  // Emits whenever the picked view's row is a new object — a different
  // view, or the same one reloaded after an edit.
  private emitSelected(): void {
    const view = this.selectedView;
    if (view !== this.emittedView) {
      this.emittedView = view;
      this.viewChange.emit(view);
    }
  }

  private track<T>(request: Observable<T>): Observable<T> {
    this.pendingRequests++;
    return request.pipe(finalize(() => this.pendingRequests--));
  }
}
