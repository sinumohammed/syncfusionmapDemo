import { ChangeDetectorRef, Component, Input, NgZone, OnChanges, OnDestroy, OnInit, SimpleChanges } from "@angular/core";
import { MatDialog } from "@angular/material/dialog";
import { Observable, of, Subject, Subscription } from "rxjs";
import { catchError, finalize, switchMap } from "rxjs/operators";
import { LldGroupWithSubGroups, LldLookups, LldSubGroup } from "./model/nx-lld.model";
import { apiErrorMessage, LldViewSelection, NxLldService, selectedViewId } from "./services/nx-lld.service";
import { LldSubGroupDialogData, NxLldSubGroupDialogComponent } from "./nx-lld-subgroup-dialog.component";
import { LldConfirmDialogData, NxLldConfirmDialogComponent } from "./nx-lld-confirm-dialog.component";

// The Sub-groups tab: pick one of the given view's groups, then its
// sub-groups (each row toggles its equipment list), with Add / Edit /
// Delete. Gets the picked view as the host passes it, {"LDID":[21]} — only
// its id is needed.
@Component({
  selector: "app-nx-lld-subgroups",
  templateUrl: "./nx-lld-subgroups.component.html",
  styleUrls: ["./nx-lld-tab.scss"]
})
export class NxLldSubGroupsComponent implements OnInit, OnChanges, OnDestroy {
  // {"LDID":[21]} — a JSON string or the parsed object.
  @Input() viewSelection: string | LldViewSelection | null = null;
  // TODO(host): the logged-in user's API token.
  @Input() token = "";

  viewId: number | null = null;
  lookups: LldLookups | null = null;
  groups: LldGroupWithSubGroups[] = [];
  selectedGroupId: number | null = null;
  // Which sub-groups show their equipment list — kept by id so a reload
  // after a save doesn't collapse them.
  readonly expandedSubGroupIds = new Set<number>();
  loading = false;

  // switchMap drops a still-running fetch for a view that's no longer picked.
  private readonly groupsRequest$ = new Subject<number | null>();
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
        .subscribe(groups => this.refresh(() => this.setGroups(groups)))
    );
  }

  get selectedGroup(): LldGroupWithSubGroups | null {
    return this.groups.find(g => g.id === this.selectedGroupId) ?? null;
  }

  ngOnInit(): void {
    this.subscriptions.add(
      this.lldService.getLookups(this.token).subscribe({
        next: lookups => this.refresh(() => (this.lookups = lookups)),
        error: (err: unknown) => console.error("[LLD] GetLookups failed:", apiErrorMessage(err), err)
      })
    );
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["viewSelection"]) {
      const id = selectedViewId(this.viewSelection);
      if (id !== this.viewId) {
        this.viewId = id;
        this.groups = [];
        this.selectedGroupId = null;
        this.expandedSubGroupIds.clear();
        this.reload();
      }
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  typeName(typeId: string): string {
    return this.lookups?.subGroupTypes.find(t => t.id === typeId)?.name ?? typeId;
  }

  templateLabel(typeId: string, templateId: string): string {
    const template = this.lookups?.subGroupTypes.find(t => t.id === typeId)?.templates.find(t => t.id === templateId);
    return template ? `${template.name} ${template.version}` : templateId;
  }

  equipmentName(id: string): string {
    return this.lookups?.equipments.find(e => e.id === id)?.name ?? id;
  }

  toggleSubGroup(sub: LldSubGroup): void {
    if (!this.expandedSubGroupIds.delete(sub.id!)) {
      this.expandedSubGroupIds.add(sub.id!);
    }
  }

  addSubGroup(): void {
    this.openSubGroupDialog();
  }

  editSubGroup(sub: LldSubGroup, event: Event): void {
    event.stopPropagation();
    this.openSubGroupDialog(sub);
  }

  deleteSubGroup(sub: LldSubGroup, event: Event): void {
    event.stopPropagation();
    this.dialog
      .open<NxLldConfirmDialogComponent, LldConfirmDialogData, boolean>(NxLldConfirmDialogComponent, {
        data: {
          title: "Delete Sub-group",
          message: `Delete sub-group "${sub.name}"? Its ${sub.equipments.length} equipment(s) will be removed too.`
        }
      })
      .afterClosed()
      .subscribe(confirmed => {
        if (confirmed) {
          this.lldService.deleteSubGroup(sub.id!, this.token).subscribe(() => {
            this.expandedSubGroupIds.delete(sub.id!);
            this.reload();
          });
        }
      });
  }

  private openSubGroupDialog(subGroup?: LldSubGroup): void {
    const group = this.selectedGroup;
    if (!group || !this.lookups) {
      return;
    }
    this.dialog
      .open<NxLldSubGroupDialogComponent, LldSubGroupDialogData, LldSubGroup>(NxLldSubGroupDialogComponent, {
        // Wide enough for each equipment's Name / Path / Attribute row.
        width: "720px",
        maxWidth: "95vw",
        data: { subGroup, group, lookups: this.lookups, token: this.token }
      })
      .afterClosed()
      .subscribe(saved => {
        if (saved) {
          // A new sub-group opens straight away to show its equipments.
          if (!subGroup && saved.id != null) {
            this.expandedSubGroupIds.add(saved.id);
          }
          this.reload();
        }
      });
  }

  // Keeps the picked group when it's still there, else the first one.
  private setGroups(groups: LldGroupWithSubGroups[]): void {
    this.groups = groups;
    if (!groups.some(g => g.id === this.selectedGroupId)) {
      this.selectedGroupId = groups[0]?.id ?? null;
    }
  }

  private reload(): void {
    this.groupsRequest$.next(this.viewId);
  }

  // The host can sit this inside an OnPush parent, or finish its HTTP calls
  // outside Angular's zone — either way an async result alone wouldn't
  // redraw. Every async update
  // goes through here: back in the zone, marked for check.
  private refresh(update: () => void): void {
    this.zone.run(() => {
      update();
      this.cdr.markForCheck();
    });
  }
}
