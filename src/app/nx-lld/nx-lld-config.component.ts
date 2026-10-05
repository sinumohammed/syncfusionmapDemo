import { Component, OnDestroy, OnInit } from "@angular/core";
import { MatDialog } from "@angular/material/dialog";
import { forkJoin, Observable, of, Subject, Subscription } from "rxjs";
import { finalize, switchMap } from "rxjs/operators";
import { LLD_VIEW_STATUS_OPTIONS, LldGroup, LldGroupWithSubGroups, LldLookups, LldOption, LldView } from "./model/nx-lld.model";
import { NxLldService } from "./services/nx-lld.service";
import { LldViewDialogData, NxLldViewDialogComponent } from "./nx-lld-view-dialog.component";
import { LldGroupDialogData, NxLldGroupDialogComponent } from "./nx-lld-group-dialog.component";
import { LldConfirmDialogData, NxLldConfirmDialogComponent } from "./nx-lld-confirm-dialog.component";

// TODO(host): replace with the logged-in user's API token (the host app
// supplies its own); passed straight through to every LLD API call.
const LLD_API_TOKEN = "";

// The LLD Configuration screen: View dropdown (New/Edit/Delete) over the
// grouped layout — one expansion panel per group of the selected view,
// listing its sub-groups. Sub-group add/edit/delete and the equipment
// toggle come next.
@Component({
  selector: "app-nx-lld-config",
  templateUrl: "./nx-lld-config.component.html",
  styleUrls: ["./nx-lld-config.component.scss"]
})
export class NxLldConfigComponent implements OnInit, OnDestroy {
  lookups: LldLookups | null = null;
  views: LldView[] = [];
  selectedViewId: number | null = null;
  groups: LldGroupWithSubGroups[] = [];
  // Which group panels are open — kept by id so a reload after a save
  // doesn't collapse them.
  readonly expandedGroupIds = new Set<number>();

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

  constructor(private lldService: NxLldService, private dialog: MatDialog) {
    this.groupsSub = this.groupsRequest$
      .pipe(switchMap(viewId => (viewId == null ? of([]) : this.track(this.lldService.getGroups(viewId, LLD_API_TOKEN)))))
      .subscribe(groups => (this.groups = groups));
  }

  get selectedView(): LldView | null {
    return this.views.find(v => v.id === this.selectedViewId) ?? null;
  }

  // The selected view's subsurface, stations and status, by name.
  get selectedSubsurfaceName(): string {
    return this.lookups?.subsurfaces.find(s => s.id === this.selectedView?.subsurfaceId)?.name ?? "";
  }
  get selectedStations(): LldOption[] {
    const view = this.selectedView;
    const subsurface = this.lookups?.subsurfaces.find(s => s.id === view?.subsurfaceId);
    return subsurface?.stations.filter(s => view!.stationIds.includes(s.id)) ?? [];
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
    this.track(forkJoin([this.lldService.getLookups(LLD_API_TOKEN), this.lldService.getViews(LLD_API_TOKEN)])).subscribe(
      ([lookups, views]) => {
        this.lookups = lookups;
        this.setViews(views, null);
      }
    );
  }

  ngOnDestroy(): void {
    this.groupsSub.unsubscribe();
  }

  // ------------------------------------------------------------- views
  onViewChange(): void {
    this.groups = [];
    this.expandedGroupIds.clear();
    this.groupsRequest$.next(this.selectedViewId);
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
          this.track(this.lldService.deleteView(view.id!, LLD_API_TOKEN)).subscribe(() => this.reloadViews(null));
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
          lookups: this.lookups,
          token: LLD_API_TOKEN
        }
      })
      .afterClosed()
      .subscribe(saved => {
        if (saved) {
          this.reloadViews(saved.id ?? null);
        }
      });
  }

  // Refetch after every save/delete (the server owns the list), then
  // select `selectId` — or keep the current one, or fall back to the first.
  private reloadViews(selectId: number | null): void {
    this.track(this.lldService.getViews(LLD_API_TOKEN)).subscribe(views => this.setViews(views, selectId));
  }

  private setViews(views: LldView[], selectId: number | null): void {
    const previousId = this.selectedViewId;
    this.views = views;
    const keep = [selectId, this.selectedViewId].find(id => id != null && views.some(v => v.id === id));
    this.selectedViewId = keep ?? views[0]?.id ?? null;
    if (this.selectedViewId !== previousId || previousId == null) {
      this.onViewChange();
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
        this.track(this.lldService.deleteGroup(group.id!, LLD_API_TOKEN)).subscribe(() => {
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
