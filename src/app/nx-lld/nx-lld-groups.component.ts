import { Component, Input, OnChanges, OnDestroy, SimpleChanges } from "@angular/core";
import { MatDialog } from "@angular/material/dialog";
import { Observable, of, Subject, Subscription } from "rxjs";
import { catchError, finalize, switchMap } from "rxjs/operators";
import { LldGroup, LldGroupWithSubGroups, LldView } from "./model/nx-lld.model";
import { apiErrorMessage, NxLldService } from "./services/nx-lld.service";
import { LldGroupDialogData, NxLldGroupDialogComponent } from "./nx-lld-group-dialog.component";
import { LldConfirmDialogData, NxLldConfirmDialogComponent } from "./nx-lld-confirm-dialog.component";

// The Groups tab: the given view's groups, with Add / Edit / Delete.
// Takes the view picked in the header's View dropdown as input.
@Component({
  selector: "app-nx-lld-groups",
  templateUrl: "./nx-lld-groups.component.html",
  styleUrls: ["./nx-lld-tab.scss"]
})
export class NxLldGroupsComponent implements OnChanges, OnDestroy {
  @Input() view: LldView | null = null;
  // TODO(host): the logged-in user's API token.
  @Input() token = "";

  groups: LldGroupWithSubGroups[] = [];
  loading = false;

  // switchMap drops a still-running fetch for a view that's no longer picked.
  private readonly groupsRequest$ = new Subject<number | null>();
  private readonly groupsSub: Subscription;

  constructor(private lldService: NxLldService, private dialog: MatDialog) {
    this.groupsSub = this.groupsRequest$
      .pipe(
        switchMap((viewId: number | null): Observable<LldGroupWithSubGroups[]> => {
          if (viewId == null) {
            return of([]);
          }
          this.loading = true;
          return this.lldService.getGroups(viewId, this.token).pipe(
            catchError((err: unknown) => {
              console.error("[LLD] GetGroups failed:", apiErrorMessage(err), err);
              return of<LldGroupWithSubGroups[]>([]);
            }),
            finalize(() => (this.loading = false))
          );
        })
      )
      .subscribe(groups => (this.groups = groups));
  }

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes["view"];
    if (change && (change.firstChange || change.previousValue?.id !== change.currentValue?.id)) {
      this.groups = [];
      this.reload();
    }
  }

  ngOnDestroy(): void {
    this.groupsSub.unsubscribe();
  }

  addGroup(): void {
    this.openGroupDialog();
  }

  editGroup(group: LldGroup): void {
    this.openGroupDialog(group);
  }

  deleteGroup(group: LldGroupWithSubGroups): void {
    const children = group.subGroups.length
      ? ` Its ${group.subGroups.length} sub-group(s) and their equipments will be deleted too.`
      : "";
    this.dialog
      .open<NxLldConfirmDialogComponent, LldConfirmDialogData, boolean>(NxLldConfirmDialogComponent, {
        data: { title: "Delete Group", message: `Delete group "${group.name}"?${children}` }
      })
      .afterClosed()
      .subscribe(confirmed => {
        if (confirmed) {
          this.lldService.deleteGroup(group.id!, this.token).subscribe(() => this.reload());
        }
      });
  }

  private openGroupDialog(group?: LldGroup): void {
    if (!this.view) {
      return;
    }
    this.dialog
      .open<NxLldGroupDialogComponent, LldGroupDialogData, LldGroup>(NxLldGroupDialogComponent, {
        width: "380px",
        data: { group, view: this.view, token: this.token }
      })
      .afterClosed()
      .subscribe(saved => {
        if (saved) {
          this.reload();
        }
      });
  }

  private reload(): void {
    this.groupsRequest$.next(this.view?.id ?? null);
  }
}
