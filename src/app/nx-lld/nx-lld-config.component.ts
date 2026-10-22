import { Component, DoCheck, Input, OnDestroy, OnInit } from "@angular/core";
import { MatDialog } from "@angular/material/dialog";
import { Observable, of, Subject, Subscription } from "rxjs";
import { catchError, finalize, map, switchMap } from "rxjs/operators";
import { LLD_VIEW_STATUS_OPTIONS, LldGroup, LldGroupWithSubGroups, LldLookups, LldSubGroup, LldView, LldViewStatus } from "./model/nx-lld.model";
import { dcTag } from "./model/dc-tag.model";
import { apiErrorMessage, hierarchyKey, NxLldService, withSubsurfaceId } from "./services/nx-lld.service";
import { LldViewDialogData, NxLldViewDialogComponent } from "./nx-lld-view-dialog.component";
import { LldGroupDialogData, NxLldGroupDialogComponent } from "./nx-lld-group-dialog.component";
import { LldSubGroupDialogData, NxLldSubGroupDialogComponent } from "./nx-lld-subgroup-dialog.component";
import { LldConfirmDialogData, NxLldConfirmDialogComponent } from "./nx-lld-confirm-dialog.component";

// TODO(host): replace with the logged-in user's API token (the host app
// supplies its own); passed straight through to every LLD API call.
const LLD_API_TOKEN = "";

// A views reload: which view to select once the list arrives — by id, or
// by name when the save didn't report one.
interface LldViewsRequest {
  selectId: number | null;
  selectName?: string;
}
interface LldViewsResult {
  views: LldView[];
  selectId: number | null;
}

// The LLD Configuration screen (reloads its Subsurface list whenever the
// host's hierarchy selection changes — see hierarchyTags): View dropdown (New/Edit/Delete) over the
// grouped layout — one expansion panel per group of the selected view,
// listing its sub-groups; each sub-group row toggles its equipment list.
@Component({
  selector: "app-nx-lld-config",
  templateUrl: "./nx-lld-config.component.html",
  styleUrls: ["./nx-lld-config.component.scss"]
})
export class NxLldConfigComponent implements OnInit, DoCheck, OnDestroy {
  // The host's current hierarchy selection — posted as-is to load the
  // Subsurface dropdown and the views. Any change reloads both, whether the
  // host passes a new array or edits this one in place (see ngDoCheck()).
  @Input() hierarchyTags: dcTag[] | null = null;

  readonly ViewStatus = LldViewStatus;
  // How the view card shows Created on / Modified on.
  readonly auditDateFormat = "dd MMM yyyy, HH:mm";
  lookups: LldLookups | null = null;
  subsurfaces: dcTag[] = [];
  views: LldView[] = [];
  selectedViewId: number | null = null;
  groups: LldGroupWithSubGroups[] = [];
  // Which group panels are open — kept by id so a reload after a save
  // doesn't collapse them.
  readonly expandedGroupIds = new Set<number>();
  // Which sub-groups show their equipment list — same idea.
  readonly expandedSubGroupIds = new Set<number>();

  // A counter, not a boolean — overlapping calls (delete -> refetch) must
  // not switch the loader off while one is still running.
  private pendingRequests = 0;
  get isLoading(): boolean {
    return this.pendingRequests > 0;
  }

  // Each push fetches that view's groups; switchMap drops a still-running
  // fetch for a view that's no longer selected, so a slow response can't
  // land under the wrong view.
  private readonly groupsRequest$ = new Subject<number | null>();
  private readonly groupsSub: Subscription;
  // Same idea for the hierarchy's subsurfaces (no tags -> no call, empty list).
  private readonly subsurfacesRequest$ = new Subject<dcTag[]>();
  private readonly subsurfacesSub: Subscription;
  // And for the hierarchy's views — a reload after a save/delete, or a new
  // hierarchy selection, drops a still-running fetch. Each push says which
  // view to select once the list arrives (see reloadViews()).
  private readonly viewsRequest$ = new Subject<LldViewsRequest>();
  private readonly viewsSub: Subscription;
  // The selected view's details — switchMap drops a still-running fetch for
  // a view that's no longer selected.
  selectedViewDetails: LldView | null = null;
  private readonly detailsRequest$ = new Subject<number | null>();
  private readonly detailsSub: Subscription;

  constructor(private lldService: NxLldService, private dialog: MatDialog) {
    this.groupsSub = this.groupsRequest$
      .pipe(switchMap(viewId => (viewId == null ? of([]) : this.track(this.lldService.getGroups(viewId, LLD_API_TOKEN)))))
      .subscribe(groups => (this.groups = groups));
    this.subsurfacesSub = this.subsurfacesRequest$
      .pipe(
        switchMap(
          (tags): Observable<dcTag[]> =>
            tags.length
              ? this.track(this.lldService.getSubsurfaces(tags, LLD_API_TOKEN)).pipe(catchError((err: unknown) => {
                  console.error("[LLD] GetSubSurfaceOperations failed:", apiErrorMessage(err), err);
                  return of<dcTag[]>([]);
                }))
              : of<dcTag[]>([])
        )
      )
      .subscribe((subsurfaces: dcTag[]) => {
        // TEMP: tracing why the Subsurface dropdown stays empty — remove afterwards.
        console.log("[LLD] subsurfaces set on the page:", subsurfaces.length, subsurfaces);
        this.subsurfaces = subsurfaces;
      });
    this.detailsSub = this.detailsRequest$
      .pipe(
        switchMap(
          (id: number | null): Observable<LldView | null> =>
            id == null
              ? of<LldView | null>(null)
              : this.track(this.lldService.getViewDetails(id, LLD_API_TOKEN)).pipe(
                  catchError((err: unknown) => {
                    console.error("[LLD] GetLDViewDetails failed:", apiErrorMessage(err), err);
                    return of<LldView | null>(null);
                  })
                )
        )
      )
      .subscribe((details: LldView | null) => (this.selectedViewDetails = details));
    this.viewsSub = this.viewsRequest$
      .pipe(
        switchMap(({ selectId, selectName }: LldViewsRequest): Observable<LldViewsResult> => {
          const tags: dcTag[] = this.hierarchyTags ?? [];
          const views$: Observable<LldView[]> = tags.length
            ? this.track(this.lldService.getViews(tags, LLD_API_TOKEN)).pipe(catchError((err: unknown) => {
                console.error("[LLD] GetLDViews failed:", apiErrorMessage(err), err);
                return of<LldView[]>([]);
              }))
            : of<LldView[]>([]);
          return views$.pipe(
            map(
              (views: LldView[]): LldViewsResult => ({
                views,
                selectId: selectId ?? views.find((v: LldView) => v.name === selectName)?.id ?? null
              })
            )
          );
        })
      )
      .subscribe((result: LldViewsResult) => this.setViews(result.views, result.selectId));
  }

  // Runs on every change detection: when the hierarchy selection differs
  // from the last one loaded (by content, so an in-place push/splice counts
  // too), its subsurfaces and its views are loaded — from the server the
  // first time, from the service's cache when going back to an earlier
  // selection. The first run loads the initial selection.
  ngDoCheck(): void {
    const key = hierarchyKey(this.hierarchyTags);
    if (key !== this.loadedHierarchyKey) {
      this.loadedHierarchyKey = key;
      // TEMP: to see when the hierarchy (re)loads while testing — remove afterwards.
      console.log("[LLD] hierarchyTags changed -> loading subsurfaces + views (cached if seen before)", this.hierarchyTags);
      this.subsurfaces = [];
      this.subsurfacesRequest$.next(this.hierarchyTags ?? []);
      this.views = [];
      this.selectedViewId = null;
      this.onViewChange();
      this.reloadViews(null);
    }
  }

  private loadedHierarchyKey: string | null = null;

  // The selected view as GetLDViewDetails returned it — or, until that
  // arrives (or if it fails), its row from the views list.
  get selectedView(): LldView | null {
    if (this.selectedViewDetails && this.selectedViewDetails.id === this.selectedViewId) {
      return this.selectedViewDetails;
    }
    return this.views.find(v => v.id === this.selectedViewId) ?? null;
  }

  get selectedStatusLabel(): string {
    return LLD_VIEW_STATUS_OPTIONS.find(o => o.value === this.selectedView?.status)?.label ?? "";
  }

  typeName(typeId: string): string {
    return this.lookups?.subGroupTypes.find(t => t.id === typeId)?.name ?? typeId;
  }
  templateLabel(typeId: string, templateId: string): string {
    const template = this.lookups?.subGroupTypes.find(t => t.id === typeId)?.templates.find(t => t.id === templateId);
    return template ? `${template.name} ${template.version}` : templateId;
  }

  ngOnInit(): void {
    // The views come with the hierarchy (ngDoCheck).
    this.track(this.lldService.getLookups(LLD_API_TOKEN)).subscribe(lookups => (this.lookups = lookups));
  }

  ngOnDestroy(): void {
    this.groupsSub.unsubscribe();
    this.subsurfacesSub.unsubscribe();
    this.viewsSub.unsubscribe();
    this.detailsSub.unsubscribe();
  }

  // ------------------------------------------------------------- views
  onViewChange(): void {
    this.groups = [];
    this.expandedGroupIds.clear();
    this.expandedSubGroupIds.clear();
    this.groupsRequest$.next(this.selectedViewId);
    this.loadViewDetails();
  }

  private loadViewDetails(): void {
    this.selectedViewDetails = null;
    this.detailsRequest$.next(this.selectedViewId);
  }

  newView(): void {
    this.openViewDialog();
  }

  editView(): void {
    if (this.selectedView) {
      this.openViewDialog(this.selectedView);
    }
  }

  deleteView(): void {
    const view = this.selectedView;
    if (!view || view.id == null) {
      return;
    }
    this.confirm("Delete View", `Delete view "${view.name}"? All its groups, sub-groups and equipments will be deleted too.`).subscribe(
      confirmed => {
        if (confirmed) {
          this.track(this.lldService.deleteView(withSubsurfaceId(view, this.subsurfaces), LLD_API_TOKEN)).subscribe(() => this.reloadViews(null));
        }
      }
    );
  }

  private openViewDialog(view?: LldView): void {
    if (!this.lookups) {
      return;
    }
    this.dialog
      .open<NxLldViewDialogComponent, LldViewDialogData, LldView>(NxLldViewDialogComponent, {
        width: "420px",
        data: {
          view,
          subsurfaces: this.subsurfaces,
          token: LLD_API_TOKEN
        }
      })
      .afterClosed()
      .subscribe(saved => {
        if (saved) {
          this.reloadViews(saved.id ?? null, saved.name);
        }
      });
  }

  // Refetch after every save/delete (the server owns the list), then
  // select `selectId` — or, when the save didn't report an id, the view
  // named `selectName` — or keep the current one, or fall back to the first.
  private reloadViews(selectId: number | null, selectName?: string): void {
    this.viewsRequest$.next({ selectId, selectName });
  }

  private setViews(views: LldView[], selectId: number | null): void {
    const previousId = this.selectedViewId;
    this.views = views;
    const keep = [selectId, this.selectedViewId].find(id => id != null && views.some(v => v.id === id));
    this.selectedViewId = keep ?? views[0]?.id ?? null;
    if (this.selectedViewId !== previousId || previousId == null) {
      this.onViewChange();
    } else {
      // Same view still selected (e.g. it was just edited) — its details
      // may have changed.
      this.loadViewDetails();
    }
  }

  // ------------------------------------------------------------ groups
  addGroup(): void {
    this.openGroupDialog();
  }

  editGroup(group: LldGroup, event: Event): void {
    event.stopPropagation();
    this.openGroupDialog(group);
  }

  deleteGroup(group: LldGroupWithSubGroups, event: Event): void {
    event.stopPropagation();
    const children = group.subGroups.length
      ? ` Its ${group.subGroups.length} sub-group(s) and their equipments will be deleted too.`
      : "";
    this.confirm("Delete Group", `Delete group "${group.name}"?${children}`).subscribe(confirmed => {
      if (confirmed) {
        this.track(this.lldService.deleteGroup(group, LLD_API_TOKEN)).subscribe(() => {
          this.expandedGroupIds.delete(group.id!);
          this.reloadGroups();
        });
      }
    });
  }

  private openGroupDialog(group?: LldGroup): void {
    const view = this.selectedView;
    if (!view) {
      return;
    }
    this.dialog
      .open<NxLldGroupDialogComponent, LldGroupDialogData, LldGroup>(NxLldGroupDialogComponent, {
        width: "380px",
        data: {
          group,
          view,
          token: LLD_API_TOKEN
        }
      })
      .afterClosed()
      .subscribe(saved => {
        if (saved) {
          // A new group opens straight away, ready for its sub-groups.
          if (!group && saved.id != null) {
            this.expandedGroupIds.add(saved.id);
          }
          this.reloadGroups();
        }
      });
  }

  // -------------------------------------------------------- sub-groups
  toggleSubGroup(sub: LldSubGroup): void {
    if (!this.expandedSubGroupIds.delete(sub.id!)) {
      this.expandedSubGroupIds.add(sub.id!);
    }
  }

  addSubGroup(group: LldGroup): void {
    this.openSubGroupDialog(group);
  }

  editSubGroup(group: LldGroup, sub: LldSubGroup, event: Event): void {
    event.stopPropagation();
    this.openSubGroupDialog(group, sub);
  }

  deleteSubGroup(sub: LldSubGroup, event: Event): void {
    event.stopPropagation();
    this.confirm(
      "Delete Sub-group",
      `Delete sub-group "${sub.name}"? Its ${sub.equipments.length} equipment(s) will be removed too.`
    ).subscribe(confirmed => {
      if (confirmed) {
        this.track(this.lldService.deleteSubGroup(sub.id!, LLD_API_TOKEN)).subscribe(() => {
          this.expandedSubGroupIds.delete(sub.id!);
          this.reloadGroups();
        });
      }
    });
  }

  equipmentName(id: string): string {
    return this.lookups?.equipments.find(e => e.id === id)?.name ?? id;
  }

  private openSubGroupDialog(group: LldGroup, subGroup?: LldSubGroup): void {
    if (!this.lookups) {
      return;
    }
    this.dialog
      .open<NxLldSubGroupDialogComponent, LldSubGroupDialogData, LldSubGroup>(NxLldSubGroupDialogComponent, {
        // Wide enough for each equipment's Name / Path / Attribute row.
        width: "720px",
        maxWidth: "95vw",
        data: { subGroup, group, lookups: this.lookups, token: LLD_API_TOKEN }
      })
      .afterClosed()
      .subscribe(saved => {
        if (saved) {
          // A new sub-group opens straight away to show its equipments.
          if (!subGroup && saved.id != null) {
            this.expandedSubGroupIds.add(saved.id);
          }
          this.reloadGroups();
        }
      });
  }

  private reloadGroups(): void {
    this.groupsRequest$.next(this.selectedViewId);
  }

  // ------------------------------------------------------------ shared
  private confirm(title: string, message: string): Observable<boolean | undefined> {
    return this.dialog
      .open<NxLldConfirmDialogComponent, LldConfirmDialogData, boolean>(NxLldConfirmDialogComponent, { data: { title, message } })
      .afterClosed();
  }

  private track<T>(request: Observable<T>): Observable<T> {
    this.pendingRequests++;
    return request.pipe(finalize(() => this.pendingRequests--));
  }
}
