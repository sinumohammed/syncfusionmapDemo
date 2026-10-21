import { ChangeDetectorRef, Component, Input, NgZone, OnChanges, OnDestroy, SimpleChanges } from "@angular/core";
import { MatDialog } from "@angular/material/dialog";
import { Observable, of, Subject, Subscription } from "rxjs";
import { catchError, filter, finalize, switchMap } from "rxjs/operators";
import { LldGroup, LldGroupWithSubGroups, LldView } from "./model/nx-lld.model";
import { apiErrorMessage, LldViewSelection, NxLldService, selectedViewId } from "./services/nx-lld.service";
import { LldGroupDialogData, NxLldGroupDialogComponent } from "./nx-lld-group-dialog.component";
import { LldConfirmDialogData, NxLldConfirmDialogComponent } from "./nx-lld-confirm-dialog.component";

// The Groups tab: the picked view's groups, with Add / Edit / Delete. Gets
// the pick as the host passes it, {"LDID":[21]}; loads the view's details
// itself for its name (heading and the group popup), reloading them when
// that view is saved (NxLldService.viewSaved$).
@Component({
  selector: "app-nx-lld-groups",
  templateUrl: "./nx-lld-groups.component.html",
  styleUrls: ["./nx-lld-tab.scss"]
})
export class NxLldGroupsComponent implements OnChanges, OnDestroy {
  // {"LDID":[21]} — a JSON string or the parsed object.
  @Input() viewSelection: string | LldViewSelection | null = null;
  // TODO(host): the logged-in user's API token.
  @Input() token = "";

  viewId: number | null = null;
  view: LldView | null = null;
  groups: LldGroupWithSubGroups[] = [];
  loading = false;

  // switchMap drops a still-running fetch for a view that's no longer picked.
  private readonly groupsRequest$ = new Subject<number | null>();
  private readonly viewRequest$ = new Subject<number | null>();
  private readonly subscriptions = new Subscription();

  constructor(private lldService: NxLldService, private dialog: MatDialog, private cdr: ChangeDetectorRef, private zone: NgZone) {
    this.subscriptions.add(
      this.groupsRequest$
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
              finalize(() => this.refresh(() => (this.loading = false)))
            );
          })
        )
        .subscribe(groups => this.refresh(() => (this.groups = groups)))
    );
    this.subscriptions.add(
      this.viewRequest$
        .pipe(
          switchMap(
            (viewId: number | null): Observable<LldView | null> =>
              viewId == null
                ? of(null)
                : this.lldService.getViewDetails(viewId, this.token).pipe(
                    catchError((err: unknown) => {
                      console.error("[LLD] GetLDViewDetails failed:", apiErrorMessage(err), err);
                      return of<LldView | null>(null);
                    })
                  )
          )
        )
        .subscribe((view: LldView | null) => this.refresh(() => (this.view = view)))
    );
    // This view was just edited — its name may have changed.
    this.subscriptions.add(
      this.lldService.viewSaved$
        .pipe(filter((id: number | null) => id != null && id === this.viewId))
        .subscribe(() => this.viewRequest$.next(this.viewId))
    );
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["viewSelection"]) {
      const id = selectedViewId(this.viewSelection);
      if (id !== this.viewId) {
        this.viewId = id;
        this.view = null;
        this.groups = [];
        this.viewRequest$.next(id);
        this.reload();
      }
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
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

  // Needs the view's details (the popup shows its name).
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
    this.groupsRequest$.next(this.viewId);
  }

  // The host can sit this inside an OnPush parent, or finish its HTTP calls
  // outside Angular's zone — either way an async result alone wouldn't
  // redraw. Every async update goes through here: back in the zone, marked
  // for check.
  private refresh(update: () => void): void {
    this.zone.run(() => {
      update();
      this.cdr.markForCheck();
    });
  }
}
