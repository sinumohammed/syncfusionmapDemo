import { Component, Input, TemplateRef, ViewChild } from "@angular/core";
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, ValidatorFn, Validators } from "@angular/forms";
import { MatDialog, MatDialogRef } from "@angular/material/dialog";
import { Observable } from "rxjs";
import { finalize } from "rxjs/operators";
import { ColDef } from "ag-grid-community";
import { CircularChartComment } from "./model/nx-circular-chart-comment-model";
import { NxCircularChartCommentsService } from "./services/nx-circular-chart-comments.service";

// TODO(host): replace with the logged-in user's API token (the host app
// supplies its own); passed straight through to every comments API call.
const COMMENTS_API_TOKEN = "";
import { DEFAULT_DIALOG_CONFIG } from "./nx-circular-chart-comments.constants";
import { ActionCellParams, NxCircularChartCommentsActionCellComponent } from "./nx-circular-chart-comments-action-cell.component";

// Blocks a date strictly AFTER today (today itself is still valid) — applied
// both as this form's own control validator (blocks typed/pasted input) AND
// via [max] on the template's <input matDatepicker> (blocks calendar
// picking) — one without the other leaves a hole a user could still get
// through the other way.
function noFutureDateValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    if (!control.value) {
      return null;
    }
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const date = toNativeDate(control.value);
    return date && date.getTime() > endOfToday.getTime() ? { futureDate: true } : null;
  };
}

// Start/End Date pair: only checked once BOTH are set — End Date may not
// come before Start Date. Set on the FormGroup (not either control) since it
// depends on both; the template shows its error under End Date.
function endNotBeforeStartValidator(): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const start = toNativeDate(group.get("startDate")?.value);
    const end = toNativeDate(group.get("endDate")?.value);
    return start && end && end.getTime() < start.getTime() ? { endBeforeStart: true } : null;
  };
}

// Just the "+" button at the top level (rendered inline in
// NxCircularChartCollectionComponent's own header, next to its year
// <select> — see that component's own template) — everything else (the
// Add-Comment form, the history grid, ITS OWN year filter, the History
// link) lives INSIDE the dialog opened from it, not in this component's
// always-visible template. Split out of NxCircularChartCollectionComponent
// (which already renders the charts/legend and was going to double in
// size otherwise) so Angular Material/ag-grid stay confined to this one
// component instead of leaking into the always-visible, Syncfusion-styled
// parent panel. Parent owns `year` (its own header dropdown — read here
// only as the POPUP's own default year on open, see openAddDialog()),
// `years` (the same 6-entry list, reused for the popup's own year filter
// so there's one source of truth for that range), and `specOptions` (its
// own circularCharts, already Hide-filtered/ordered) — this component has
// no idea where any of the three come from, same "dumb, presentational"
// split NxCircularChartComponent already uses relative to its own
// collection.
@Component({
  selector: "app-nx-circular-chart-comments",
  templateUrl: "./nx-circular-chart-comments.component.html",
  styleUrls: ["./nx-circular-chart-comments.component.scss"]
})
export class NxCircularChartCommentsComponent {
  @Input() year!: number;
  @Input() years: number[] = [];
  @Input() specOptions: string[] = [];
  // The logged-in user's display name, from the host — auto-fills (and
  // locks) Reported By on every new comment. Unset -> Reported By stays a
  // normal required text box, same as before this existed.
  @Input() currentUser?: string | null;

  // Must live in THIS component, not a shared/global template — MatDialog's
  // TemplateRef-based open() reuses THIS SAME instance across every open
  // (unlike a component-based dialog, which gets a fresh instance each
  // time), which is exactly why openAddDialog() below has to explicitly
  // form.reset() every time rather than relying on a fresh component to
  // start blank.
  @ViewChild("addCommentsDialog", { static: false }) addCommentsDialog!: TemplateRef<HTMLElement>;
  dialogRef?: MatDialogRef<HTMLElement>;

  readonly maxDate = new Date();

  // The popup's OWN year filter for its history grid — deliberately
  // separate from the parent's own `year` @Input (that one only seeds this
  // as a starting point each time the dialog opens, see openAddDialog())
  // so browsing a different year inside the popup never desyncs the
  // collection header's own dropdown.
  dialogYear!: number;

  // Non-null while editRow() below is populating the form for an existing
  // entry — save() then sends this id with the payload (same save call as
  // an Add, which sends none). Cleared back to null on openAddDialog()
  // (starting a fresh Add) and after a successful save.
  editingId: number | null = null;

  form: FormGroup;
  rowData: CircularChartComment[] = [];

  // True while any comments API call (list, save, delete) is in flight —
  // drives the progress bar over the grid and disables Save/Update. A
  // counter, not a plain boolean: save -> refetch overlap, and the save's
  // own completion must not switch the loader off while its refetch is
  // still running.
  private pendingRequests = 0;
  get isLoading(): boolean {
    return this.pendingRequests > 0;
  }

  // suppressMovable — this grid's own 8 columns are a fixed set (see
  // columnDefs' own comment on their widths), never meant to be
  // user-reorderable, so there's no reason to leave ag-grid's default
  // column-header drag-to-reorder reachable at all. Confirmed live as the
  // source of a stray "☰ Move [object Object]" badge appearing OUTSIDE
  // this dialog, over the main chart panel behind it: that's ag-grid's own
  // DragAndDropService.GHOST_TEMPLATE, appended once to document.body (not
  // scoped to this grid/dialog) for ANY column-header drag; if this
  // dialog/grid gets torn down (e.g. closed) while a header drag is still
  // in progress, ag-grid's own cleanup — bound to a document `mouseup` —
  // can miss its chance to remove it, leaving that ghost stuck and visible
  // wherever it last floated. Disabling the drag entirely removes the only
  // way to trigger it, rather than trying to patch that cleanup path.
  defaultColDef: ColDef = { resizable: true, sortable: true, suppressMovable: true };

  // Edit/Delete both use NxCircularChartCommentsActionCellComponent (a real
  // ICellRendererAngularComp, see its own header comment for why a plain
  // function cellRenderer — tried first, both string- and HTMLElement-
  // returning variants — never actually got invoked for these two columns
  // in this ag-grid-angular install, confirmed live via a debug log that
  // never fired, despite the column's own headerName rendering fine).
  // Explicit widths on every column except `desc` (flex: 1, min-width so
  // it never gets squeezed to unreadable) — confirmed live: with every
  // column left at ag-grid's own ~200px default, the 8 columns needed
  // ~1370px total against a 600px dialog, so only the first 4 ever
  // rendered (ag-grid virtualizes columns outside the current scroll
  // viewport — not a bug, just meant a horizontal scrollbar was the ONLY
  // way to reach Impact/Reported By/Edit/Delete at that width). These
  // widths sum to ~800px including Desc's own min-width, matched by this
  // component's own dialog width (600px -> 900px, see openAddDialog()).
  columnDefs: ColDef[] = [
    { field: "date", headerName: "Date", width: 110, sort: "desc" },
    { field: "desc", headerName: "Desc", flex: 1, minWidth: 180 },
    { field: "spec", headerName: "Spec", width: 90 },
    { field: "customer", headerName: "Customer", width: 110 },
    { field: "isCustomer", headerName: "Impact", width: 120, valueFormatter: p => (p.value ? "Customer" : "Non-Customer") },
    { field: "startDate", headerName: "Start Date", width: 105 },
    { field: "endDate", headerName: "End Date", width: 105 },
    { field: "reportedBy", headerName: "Reported By", width: 120 },
    {
      colId: "editAction",
      field: "id",
      headerName: "Edit",
      width: 70,
      sortable: false,
      filter: false,
      cellRenderer: NxCircularChartCommentsActionCellComponent,
      cellRendererParams: { label: "Edit", onClick: (data: unknown) => this.editRow(data as CircularChartComment) } as Partial<ActionCellParams>
    },
    {
      colId: "deleteAction",
      field: "id",
      headerName: "Delete",
      width: 90,
      sortable: false,
      filter: false,
      cellRenderer: NxCircularChartCommentsActionCellComponent,
      cellRendererParams: { label: "Delete", onClick: (data: unknown) => this.deleteRow(data as CircularChartComment) } as Partial<ActionCellParams>
    }
  ];

  constructor(private fb: FormBuilder, private dialog: MatDialog, private commentsService: NxCircularChartCommentsService) {
    this.form = this.fb.group(
      {
        date: [null, [Validators.required, noFutureDateValidator()]],
        desc: ["", Validators.required],
        spec: ["", Validators.required],
        reportedBy: ["", Validators.required],
        customer: ["", Validators.required],
        isCustomer: [false, Validators.required],
        startDate: [null],
        endDate: [null]
      },
      { validators: endNotBeforeStartValidator() }
    );
  }

  // TODO: stub — the sketch shows a separate "History" link/action with no
  // defined behavior. Left inert (present, does nothing) rather than
  // guessing what it should open.
  openHistory(): void {
    // Intentionally empty — see this method's own comment.
  }

  openAddDialog(): void {
    this.dialogYear = this.year;
    this.editingId = null;
    this.refetch();
    // Explicit reset, not relying on the form's own initial state — see
    // this component's own header comment on why a TemplateRef dialog
    // needs this every open, not just once in the constructor.
    this.applyRowToForm();
    this.dialogRef = this.dialog.open(this.addCommentsDialog, {
      ...DEFAULT_DIALOG_CONFIG,
      // Wide enough for the grid below to show all 10 columns without
      // horizontal scrolling for the common case — see columnDefs' own
      // comment (~1010px with the Start/End Date columns).
      width: "1060px",
      maxWidth: "95vw",
      data: { title: "Add Comment", specOptions: this.specOptions }
    });
  }

  onDialogYearChange(year: string): void {
    this.dialogYear = Number(year);
    this.refetch();
  }

  // Backs the grid's own Edit column — populates the form with this row's
  // own values (date parsed back to a real Date for the datepicker) and
  // flags editingId so save() below sends this row's id (an edit) instead
  // of none (a new comment). The row stays visible/editable from the SAME
  // already-open dialog (its own grid sits right below the form) rather
  // than opening a second dialog.
  editRow(row: CircularChartComment): void {
    this.editingId = row.id ?? null;
    this.applyRowToForm(row);
  }

  // Bound to the form's own "Cancel edit" button (only shown while
  // editingId is set) — resets back to a blank Add form WITHOUT
  // re-opening the dialog (unlike openAddDialog(), which also calls
  // dialog.open() — reusing it here would stack a second dialog instance
  // on top of the one already open).
  cancelEdit(): void {
    this.editingId = null;
    this.applyRowToForm();
  }

  // Fetches the grid's rows from the API for dialogYear (year sent as the
  // payload, same as the trend fetch) — on dialog open, on the popup's own
  // year change, and after every save/edit/delete, so the grid always shows
  // what the server has (ids included) rather than a locally patched copy.
  private refetch(): void {
    this.trackLoading(this.commentsService.getByYear({ year: this.dialogYear }, COMMENTS_API_TOKEN)).subscribe({
      next: rows => (this.rowData = Array.isArray(rows) ? rows : []),
      error: err => console.error("[NxCircularChartComments] Loading comments failed:", err)
    });
  }

  // Today when `year` is the current year (the common case — logging
  // something that just happened), else Jan 1 of that year — a January
  // default reads more naturally than "today's month/day in a past year"
  // when the user has deliberately switched to an older year before
  // clicking +.
  private defaultDateFor(year: number): Date {
    const today = new Date();
    return year === today.getFullYear() ? today : new Date(year, 0, 1);
  }

  // Shared by openAddDialog() (row omitted -> blank/default form),
  // editRow() (row given -> populated for editing), and save()'s own
  // post-success reset (back to blank, ready for another Add) — one place
  // that knows the form's own field shape instead of three copies of the
  // same reset object drifting apart.
  private applyRowToForm(row?: CircularChartComment): void {
    this.form.reset({
      date: row ? toNativeDate(row.date) : this.defaultDateFor(this.dialogYear),
      desc: row?.desc ?? "",
      spec: row?.spec ?? this.specOptions[0] ?? "",
      // An edit keeps whoever originally reported it; a new comment is the
      // current user.
      reportedBy: row?.reportedBy ?? this.currentUser ?? "",
      customer: row?.customer ?? "",
      isCustomer: row?.isCustomer ?? false,
      startDate: toNativeDate(row?.startDate),
      endDate: toNativeDate(row?.endDate)
    });
    // Auto-filled -> not editable. disable() also drops it from
    // form.value, which is why save() reads it via getRawValue().
    const reportedBy = this.form.get("reportedBy");
    if (this.currentUser) {
      reportedBy?.disable({ emitEvent: false });
    } else {
      reportedBy?.enable({ emitEvent: false });
    }
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.isLoading) {
      return; // a save/refetch is still running — no double submit
    }
    const raw = this.form.getRawValue();
    // Add and edit are the same save call: an edit carries its existing id,
    // a new comment carries none — the server assigns it.
    const payload: CircularChartComment = {
      ...(this.editingId != null ? { id: this.editingId } : {}),
      date: this.toIsoDate(raw.date),
      desc: raw.desc,
      spec: raw.spec,
      reportedBy: raw.reportedBy,
      customer: raw.customer,
      isCustomer: raw.isCustomer === true,
      startDate: raw.startDate ? this.toIsoDate(raw.startDate) : null,
      endDate: raw.endDate ? this.toIsoDate(raw.endDate) : null
    };
    this.trackLoading(this.commentsService.save(payload, COMMENTS_API_TOKEN)).subscribe({
      next: () => {
        this.editingId = null;
        // Refetch rather than patching rowData locally — the server owns the
        // ids, and an edit can move a comment to a different year than the
        // one the grid is showing.
        this.refetch();
        this.applyRowToForm();
      },
      error: err => console.error("[NxCircularChartComments] Saving the comment failed:", err)
    });
  }

  closeDialog(): void {
    this.dialogRef?.close();
  }

  // Backs the grid's own Delete column — confirm() first (a real delete,
  // not reversible), then delete by id and refetch, same as save().
  private deleteRow(row: CircularChartComment): void {
    if (row.id == null || !window.confirm(`Delete this comment (${row.desc || row.spec})?`)) {
      return;
    }
    this.trackLoading(this.commentsService.delete(row.id, COMMENTS_API_TOKEN)).subscribe({
      next: () => this.refetch(),
      error: err => console.error("[NxCircularChartComments] Deleting the comment failed:", err)
    });
  }

  // Counts `request$` as in flight (isLoading) from subscribe until it
  // completes, errors or is unsubscribed.
  private trackLoading<T>(request$: Observable<T>): Observable<T> {
    this.pendingRequests++;
    return request$.pipe(finalize(() => (this.pendingRequests = Math.max(0, this.pendingRequests - 1))));
  }

  // The datepicker's value type depends on whichever DateAdapter the HOST
  // app provides — a native Date with MatNativeDateModule (this demo), but
  // a Moment with MatMomentDateModule, a Luxon DateTime with the Luxon
  // adapter, etc. Reported live: a host on a Moment adapter crashed here
  // with "value.getFullYear is not a function" once a date was picked from
  // the calendar (a Moment prints just like a Date, but has no
  // getFullYear()). Normalize to a native Date first, whatever it is.
  private toIsoDate(value: unknown): string {
    const date = toNativeDate(value);
    if (!date) {
      throw new Error(`Unrecognized date value: ${String(value)}`);
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}

// Date -> as is; Moment (toDate()) / Luxon (toJSDate()) -> their own
// native-Date conversion (local calendar day preserved); "yyyy-MM-dd" ->
// parsed as a LOCAL date (new Date("2025-01-01") would parse it as UTC
// midnight, i.e. the previous day west of GMT); anything else -> new
// Date(value). Returns null for anything that doesn't yield a valid date.
function toNativeDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof (value as { toDate?: unknown }).toDate === "function") {
    date = (value as { toDate(): Date }).toDate();
  } else if (typeof (value as { toJSDate?: unknown }).toJSDate === "function") {
    date = (value as { toJSDate(): Date }).toJSDate();
  } else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    date = new Date(y, m - 1, d);
  } else {
    date = new Date(value as string | number);
  }
  return isNaN(date.getTime()) ? null : date;
}
