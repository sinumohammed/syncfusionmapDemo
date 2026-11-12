import { ChangeDetectorRef, Component, Input, NgZone, OnChanges, OnDestroy, SimpleChanges } from "@angular/core";
import { MatDialog } from "@angular/material/dialog";
import { asapScheduler, from, Observable, of, Subject, Subscription } from "rxjs";
import { catchError, concatMap, filter, finalize, observeOn, switchMap } from "rxjs/operators";
import { groupTypeId, LldGroupTypeOption, LldGroupWithSubGroups, LldSeries, LldSeriesSubGroup, LldView } from "./model/nx-lld.model";
import { apiErrorMessage, LldViewSelection, NxLldService, selectedViewId } from "./services/nx-lld.service";
import { LldSeriesSubGroupDialogData, NxLldSeriesSubGroupDialogComponent } from "./nx-lld-series-subgroup-dialog.component";
import { LldConfirmDialogData, NxLldConfirmDialogComponent } from "./nx-lld-confirm-dialog.component";

// The Group dropdown's "All" — 0 like GetLDGroupDetails' GID 0. Not null:
// mat-select treats a null option as "no selection" and shows it empty.
export const LLD_ALL_GROUPS = 0;

// A sub-group row with the group it belongs to and its series.
interface LldSubGroupRow {
  subGroup: LldSeriesSubGroup;
  group: LldGroupWithSubGroups;
  series: LldSeries | null;
}

// The Sub-groups tab ("Equipment Sub-groups Mapping"): a Group dropdown
// (All, or one of the view's groups) and its sub-groups. Add Sub-group
// works either way — the popup (NxLldSeriesSubGroupDialogComponent) has its
// own Group dropdown, pre-selected with the tab's pick. Gets the picked view
// as the host passes it, {"LDID":[21]}; loads its details for the stations
// the popup shows.
@Component({
  selector: "app-nx-lld-subgroups",
  templateUrl: "./nx-lld-subgroups.component.html",
  styleUrls: ["./nx-lld-tab.scss"]
})
export class NxLldSubGroupsComponent implements OnChanges, OnDestroy {
  // {"LDID":[21]} — a JSON string or the parsed object.
  @Input() viewSelection: string | LldViewSelection | null = null;
  // TODO(host): the logged-in user's API token.
  @Input() token = "";
  // The add / edit / delete permission — ONE value shared by every LLD
  // component through NxLldService (hasPermission$). False (the default)
  // hides Add Sub-group and the Edit / Delete icons.
  @Input() set hasPermission(value: boolean) {
    this.lldService.setHasPermission(value);
  }
  get hasPermission(): boolean {
    return this.permitted;
  }
  private permitted = false;

  readonly allGroups = LLD_ALL_GROUPS;
  viewId: number | null = null;
  groups: LldGroupWithSubGroups[] = [];
  selectedGroupId: number = LLD_ALL_GROUPS;
  // The view's details — its stations go to the popup.
  view: LldView | null = null;
  // Rebuilt only when the groups, the pick or the series change — a getter
  // would hand *ngFor new rows on every check and swallow button clicks.
  rows: LldSubGroupRow[] = [];
  // GetLDGroupTypes — the group's type name and its Id for GetLDSeries.
  typeOptions: LldGroupTypeOption[] = [];
  // Every series met so far, by id — for the rows' series names / colours.
  readonly seriesById = new Map<number, LldSeries>();
  loading = false;
  busy = false;

  // switchMap drops a still-running fetch for a view that's no longer picked.
  private readonly groupsRequest$ = new Subject<number | null>();
  private readonly viewRequest$ = new Subject<number | null>();
  private readonly subscriptions = new Subscription();

  constructor(private lldService: NxLldService, private dialog: MatDialog, private cdr: ChangeDetectorRef, private zone: NgZone) {
    // observeOn(asap): applied on the next tick, not mid-check.
    this.permitted = this.lldService.hasPermission;
    this.subscriptions.add(
      this.lldService.hasPermission$.pipe(observeOn(asapScheduler)).subscribe(value => this.refresh(() => (this.permitted = value)))
    );
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
        .subscribe(groups => this.refresh(() => this.setGroups(groups)))
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
    // This view was just edited — its stations may have changed.
    this.subscriptions.add(
      this.lldService.viewSaved$
        .pipe(filter((id: number | null) => id != null && id === this.viewId))
        .subscribe(() => this.viewRequest$.next(this.viewId))
    );
  }

  get selectedGroup(): LldGroupWithSubGroups | null {
    return this.groups.find(g => g.id === this.selectedGroupId) ?? null;
  }

  readonly trackRow = (_: number, row: LldSubGroupRow) => row.subGroup.id;

  onGroupChange(groupId: number): void {
    this.selectedGroupId = groupId;
    this.updateRows();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Again only if the first fetch failed (an empty list).
    if (!this.typeOptions.length) {
      this.loadGroupTypes();
    }
    if (changes["viewSelection"]) {
      const id = selectedViewId(this.viewSelection);
      if (id !== this.viewId) {
        this.viewId = id;
        this.groups = [];
        this.view = null;
        this.selectedGroupId = LLD_ALL_GROUPS;
        this.updateRows();
        this.viewRequest$.next(id);
        this.reload();
      }
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.seriesLoad.unsubscribe();
  }

  typeName(group: LldGroupWithSubGroups): string {
    if (group.type == null) {
      return "";
    }
    return this.typeOptions.find(o => o.value === Number(group.type))?.label ?? String(group.type);
  }

  // The popup's Group is pre-selected with the tab's pick (none under All).
  addSubGroup(): void {
    this.openDialog(this.selectedGroup?.id ?? null);
  }

  editSubGroup(row: LldSubGroupRow): void {
    // The row's own group — under All the dropdown doesn't name it.
    this.openDialog(row.group.id ?? null, row.subGroup);
  }

  deleteSubGroup(row: LldSubGroupRow): void {
    if (!this.hasPermission || this.busy) {
      return;
    }
    this.dialog
      .open<NxLldConfirmDialogComponent, LldConfirmDialogData, boolean>(NxLldConfirmDialogComponent, {
        data: { title: "Delete Sub-group", message: `Delete this sub-group of "${row.group.name}"?` }
      })
      .afterClosed()
      .subscribe(confirmed => {
        if (confirmed) {
          this.refresh(() => (this.busy = true));
          this.lldService
            .deleteSeriesSubGroup(row.subGroup.id!, this.token)
            .pipe(finalize(() => this.refresh(() => (this.busy = false))))
            .subscribe({
              next: () => this.reload(),
              error: (err: unknown) => console.error("[LLD] Delete sub-group failed:", apiErrorMessage(err), err)
            });
        }
      });
  }

  private openDialog(groupId: number | null, subGroup?: LldSeriesSubGroup): void {
    if (!this.hasPermission || !this.groups.length) {
      return;
    }
    // The groups without the tab-only sub-group lists.
    const groups = this.groups.map(({ subGroups, seriesSubGroups, ...group }) => group);
    this.dialog
      .open<NxLldSeriesSubGroupDialogComponent, LldSeriesSubGroupDialogData, LldSeriesSubGroup>(NxLldSeriesSubGroupDialogComponent, {
        width: "480px",
        maxWidth: "95vw",
        data: { subGroup, groups, groupId, stationNames: this.view?.stationNames ?? [], token: this.token }
      })
      .afterClosed()
      .subscribe(saved => {
        if (saved) {
          this.reload();
        }
      });
  }

  private loadGroupTypes(): void {
    this.subscriptions.add(
      this.lldService.getGroupTypes(this.token).subscribe({
        next: options =>
          this.refresh(() => {
            this.typeOptions = options;
            this.loadSeries();
          }),
        error: (err: unknown) => console.error("[LLD] GetLDGroupTypes failed:", apiErrorMessage(err), err)
      })
    );
  }

  // The series of every group type in the view (cached per type), for the
  // rows' series names. One type at a time (concatMap): the host's HTTP
  // service cancels a pending call when another starts with the same token,
  // so parallel GetLDSeries calls would cancel each other. A new run
  // replaces one still going.
  private loadSeries(): void {
    const typeIds = new Set(this.groups.map(g => groupTypeId(g.type, this.typeOptions)).filter((id): id is number => id != null));
    this.seriesLoad.unsubscribe();
    this.seriesLoad = from([...typeIds])
      .pipe(
        concatMap(typeId =>
          this.lldService.getSeries(typeId, this.token).pipe(
            catchError((err: unknown) => {
              console.error("[LLD] GetLDSeries failed:", apiErrorMessage(err), err);
              return of<LldSeries[]>([]);
            })
          )
        )
      )
      .subscribe(series =>
        this.refresh(() => {
          series.forEach(s => this.seriesById.set(s.id, s));
          this.updateRows();
        })
      );
  }
  private seriesLoad = Subscription.EMPTY;

  // Keeps the pick (All included) when it's still there, else All.
  private setGroups(groups: LldGroupWithSubGroups[]): void {
    this.groups = groups;
    if (this.selectedGroupId !== LLD_ALL_GROUPS && !groups.some(g => g.id === this.selectedGroupId)) {
      this.selectedGroupId = LLD_ALL_GROUPS;
    }
    this.updateRows();
    this.loadSeries();
  }

  // All: every group's sub-groups, group by group; else the picked group's.
  private updateRows(): void {
    const groups = this.selectedGroupId === LLD_ALL_GROUPS ? this.groups : this.groups.filter(g => g.id === this.selectedGroupId);
    this.rows = groups.reduce<LldSubGroupRow[]>(
      (rows, group) =>
        rows.concat(
          group.seriesSubGroups.map(subGroup => ({
            subGroup,
            group,
            series: subGroup.seriesId == null ? null : this.seriesById.get(subGroup.seriesId) ?? { id: subGroup.seriesId, name: String(subGroup.seriesId), color: "" }
          }))
        ),
      []
    );
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
