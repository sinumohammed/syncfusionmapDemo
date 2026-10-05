import { Component, OnInit } from "@angular/core";
import { MatDialog } from "@angular/material/dialog";
import { forkJoin, Observable } from "rxjs";
import { finalize } from "rxjs/operators";
import { LLD_VIEW_STATUS_OPTIONS, LldLookups, LldOption, LldView } from "./model/nx-lld.model";
import { NxLldService } from "./services/nx-lld.service";
import { LldViewDialogData, NxLldViewDialogComponent } from "./nx-lld-view-dialog.component";
import { LldConfirmDialogData, NxLldConfirmDialogComponent } from "./nx-lld-confirm-dialog.component";

// TODO(host): replace with the logged-in user's API token (the host app
// supplies its own); passed straight through to every LLD API call.
const LLD_API_TOKEN = "";

// The LLD Configuration screen: View dropdown (New/Edit/Delete) over the
// grouped View -> Groups -> Sub-groups -> Equipments layout. Groups and
// sub-groups come in the next steps.
@Component({
  selector: "app-nx-lld-config",
  templateUrl: "./nx-lld-config.component.html",
  styleUrls: ["./nx-lld-config.component.scss"]
})
export class NxLldConfigComponent implements OnInit {
  lookups: LldLookups | null = null;
  views: LldView[] = [];
  selectedViewId: number | null = null;

  // A counter, not a boolean — overlapping calls (delete -> refetch) must
  // not switch the loader off while one is still running.
  private pendingRequests = 0;
  get isLoading(): boolean {
    return this.pendingRequests > 0;
  }

  constructor(private lldService: NxLldService, private dialog: MatDialog) {}

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

  ngOnInit(): void {
    this.track(forkJoin([this.lldService.getLookups(LLD_API_TOKEN), this.lldService.getViews(LLD_API_TOKEN)])).subscribe(
      ([lookups, views]) => {
        this.lookups = lookups;
        this.setViews(views, null);
      }
    );
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
          this.track(this.lldService.deleteView(view.id!, LLD_API_TOKEN)).subscribe(() => this.reloadViews(null));
        }
      });
  }

  private openViewDialog(view?: LldView): void {
    if (!this.lookups) {
      return;
    }
    this.dialog
      .open<NxLldViewDialogComponent, LldViewDialogData, LldView>(NxLldViewDialogComponent, {
        width: "420px",
        autoFocus: true,
        data: {
          view,
          lookups: this.lookups,
          takenNames: this.views.filter(v => v.id !== view?.id).map(v => v.name),
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
    this.views = views;
    const keep = [selectId, this.selectedViewId].find(id => id != null && views.some(v => v.id === id));
    this.selectedViewId = keep ?? views[0]?.id ?? null;
  }

  private track<T>(request: Observable<T>): Observable<T> {
    this.pendingRequests++;
    return request.pipe(finalize(() => this.pendingRequests--));
  }
}
