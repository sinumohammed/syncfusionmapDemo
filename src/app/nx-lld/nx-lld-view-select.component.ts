import { ChangeDetectorRef, Component, DoCheck, EventEmitter, Input, NgZone, OnDestroy, Output } from "@angular/core";
import { MatDialog } from "@angular/material/dialog";
import { asapScheduler, forkJoin, Observable, of, Subject, Subscription } from "rxjs";
import { catchError, finalize, map, observeOn, switchMap } from "rxjs/operators";
import { LldView } from "./model/nx-lld.model";
import { dcTag } from "./model/dc-tag.model";
import { apiErrorMessage, hierarchyKey, NxLldService, withSubsurfaceId } from "./services/nx-lld.service";
import { LldViewDialogData, NxLldViewDialogComponent } from "./nx-lld-view-dialog.component";
import { LldConfirmDialogData, NxLldConfirmDialogComponent } from "./nx-lld-confirm-dialog.component";

// What the host can switch on the dropdown.
export interface LldViewSelectConfig {
  // true -> New / Edit / Delete icons, shown while hovering the dropdown;
  // false -> the list only.
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
// New opens the View popup empty; Edit fetches the view's details
// (GetLDViewDetails) first; Delete asks first. All three only when
// config.showToolbar is on.
@Component({
  selector: "app-nx-lld-view-select",
  templateUrl: "./nx-lld-view-select.component.html",
  styleUrls: ["./nx-lld-view-select.component.scss"]
})
export class NxLldViewSelectComponent implements DoCheck, OnDestroy {
  // The host's current hierarchy selection — any change (new array or
  // in-place edit) reloads the list.
  @Input() hierarchyTags: dcTag[] | null = null;
  // TODO(host): the logged-in user's API token.
  @Input() token = "";
  @Input() config: LldViewSelectConfig = { showToolbar: true };
  // The picked view (its list row), or null when there's none.
  @Output() readonly viewChange = new EventEmitter<LldView | null>();

  views: LldView[] = [];
  selectedViewId: number | null = null;
  // Set while New / Edit fetch what the popup needs, so a double-click
  // can't open two popups.
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

  constructor(private lldService: NxLldService, private dialog: MatDialog, private cdr: ChangeDetectorRef, private zone: NgZone) {
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
      .subscribe(({ views, selectId }) => this.refresh(() => this.setViews(views, selectId)));
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

  newView(): void {
    this.openEditor(null);
  }

  editView(): void {
    const view = this.selectedView;
    if (view && view.id != null) {
      this.openEditor(view.id);
    }
  }

  // Edit needs the view's details first (cached per view, so usually
  // instant); New opens at once. The hierarchy's subsurfaces load inside
  // the popup, with its own loader. The loader here goes off and the popup
  // opens in one step, inside the zone (see refresh()) — opened outside it,
  // the popup and the loader wouldn't redraw until the next click.
  private openEditor(viewId: number | null): void {
    if (this.editLoading) {
      return;
    }
    if (viewId == null) {
      this.openViewDialog(undefined);
      return;
    }
    this.editLoading = true;
    this.lldService
      .getViewDetails(viewId, this.token)
      .pipe(finalize(() => this.refresh(() => (this.editLoading = false))))
      .subscribe({
        next: (details: LldView) =>
          this.refresh(() => {
            this.editLoading = false;
            this.openViewDialog(details);
          }),
        error: (err: unknown) => console.error("[LLD] View popup: loading details failed:", apiErrorMessage(err), err)
      });
  }

  // Asks first, then sends the view's full details back with Status 3 —
  // the same SaveLD call as an edit (see NxLldService.deleteView()).
  deleteView(): void {
    const view = this.selectedView;
    if (!view || view.id == null || this.editLoading) {
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
        if (!confirmed) {
          return;
        }
        // The subsurfaces fill in SubSurfaceOperationId by name, as Edit's
        // popup does (the details carry it as 0).
        this.refresh(() => (this.editLoading = true));
        forkJoin([this.lldService.getViewDetails(view.id!, this.token), this.lldService.getSubsurfaces(this.hierarchyTags ?? [], this.token)])
          .pipe(
            switchMap(([details, subsurfaces]: [LldView, dcTag[]]) =>
              this.lldService.deleteView(withSubsurfaceId(details, subsurfaces), this.token)
            ),
            finalize(() => this.refresh(() => (this.editLoading = false)))
          )
          .subscribe({
            next: () => this.reloadViews(null),
            error: (err: unknown) => console.error("[LLD] Delete view failed:", apiErrorMessage(err), err)
          });
      });
  }

  private openViewDialog(view: LldView | undefined): void {
    const subsurfaces = this.lldService.getSubsurfaces(this.hierarchyTags ?? [], this.token);
    this.dialog
      .open<NxLldViewDialogComponent, LldViewDialogData, LldView>(NxLldViewDialogComponent, {
        width: "420px",
        data: { view, subsurfaces, token: this.token }
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
    return request.pipe(finalize(() => this.refresh(() => this.pendingRequests--)));
  }

  // The host can sit this inside an OnPush parent, or finish its HTTP calls
  // outside Angular's zone — either way an async result alone wouldn't
  // redraw (the dropdown stayed blank until a hover). Every async update
  // goes through here: back in the zone, marked for check.
  private refresh(update: () => void): void {
    this.zone.run(() => {
      update();
      this.cdr.markForCheck();
    });
  }
}
