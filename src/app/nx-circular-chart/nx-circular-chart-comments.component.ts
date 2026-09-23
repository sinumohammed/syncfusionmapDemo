import { Component, Input, TemplateRef, ViewChild } from "@angular/core";
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, ValidatorFn, Validators } from "@angular/forms";
import { MatDialog, MatDialogRef } from "@angular/material/dialog";
import { ColDef } from "ag-grid-community";
import { CircularChartComment } from "./model/nx-circular-chart-comment-model";
import { NxCircularChartCommentsService } from "./services/nx-circular-chart-comments.service";
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
    return new Date(control.value).getTime() > endOfToday.getTime() ? { futureDate: true } : null;
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
  // entry — save() branches on this to call commentsService.update()
  // instead of .save(). Cleared back to null on openAddDialog() (starting
  // a fresh Add) and after a successful save/update.
  editingId: number | null = null;

  form: FormGroup;
  rowData: CircularChartComment[] = [];

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
    { field: "impact", headerName: "Impact", width: 100 },
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
    this.form = this.fb.group({
      date: [null, [Validators.required, noFutureDateValidator()]],
      desc: ["", Validators.required],
      spec: ["", Validators.required],
      reportedBy: ["", Validators.required],
      customer: ["", Validators.required],
      impact: ["Non-Custom", Validators.required],
      valid: [false]
    });
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
      // Wide enough for the grid below to show all 8 columns without
      // horizontal scrolling for the common case — see columnDefs' own
      // comment for the ~800px this needs.
      width: "900px",
      data: { title: "Add Comment", specOptions: this.specOptions }
    });
  }

  onDialogYearChange(year: string): void {
    this.dialogYear = Number(year);
    this.refetch();
  }

  // Backs the grid's own Edit column — populates the form with this row's
  // own values (date parsed back to a real Date for the datepicker) and
  // flags editingId so save() below knows to update() this row instead of
  // creating a new one. The row stays visible/editable from the SAME
  // already-open dialog (its own grid sits right below the form) rather
  // than opening a second dialog.
  editRow(row: CircularChartComment): void {
    this.editingId = row.id;
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

  // TODO: real "get list" API call — called on dialog open, on the
  // popup's own year change, and after every save/update/delete (see each
  // of their own comments), same trigger points a real host's own GET
  // would need. Logged here so a save -> refresh round trip is visible in
  // the console end to end, not just save()'s own payload log.
  private refetch(): void {
    console.log("[TODO] GET comments list — year:", this.dialogYear);
    this.commentsService.getByYear(this.dialogYear).subscribe(rows => {
      console.log("[TODO] GET comments list resolved — rows:", rows);
      this.rowData = rows;
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
      date: row ? new Date(row.date) : this.defaultDateFor(this.dialogYear),
      desc: row?.desc ?? "",
      spec: row?.spec ?? this.specOptions[0] ?? "",
      reportedBy: row?.reportedBy ?? "",
      customer: row?.customer ?? "",
      impact: row?.impact ?? "Non-Custom",
      valid: row?.valid ?? false
    });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.value;
    const entry: Omit<CircularChartComment, "id"> = {
      date: this.toIsoDate(raw.date),
      desc: raw.desc,
      spec: raw.spec,
      reportedBy: raw.reportedBy,
      customer: raw.customer,
      impact: raw.impact,
      valid: raw.valid
    };
    // TODO: real save/update API call — payload logged here so the actual
    // request/response wiring is easy to verify in the console right up
    // until a real endpoint replaces NxCircularChartCommentsService's own
    // mock. The mock call right below already exercises the same
    // save-then-refresh flow a real API would (see refetch()'s own TODO
    // log), so this is confirmation, not a placeholder standing in for
    // missing behavior.
    console.log(this.editingId != null ? `[TODO] UPDATE comment id=${this.editingId} — payload:` : "[TODO] SAVE new comment — payload:", entry);
    // editingId set -> update() the existing row; otherwise save() a new
    // one — see editRow()'s own comment.
    const request$ = this.editingId != null ? this.commentsService.update(this.editingId, entry) : this.commentsService.save(entry);
    request$.subscribe(() => {
      this.editingId = null;
      // Re-fetch rather than locally patching `rowData` — the datepicker
      // lets a user pick any past date up to today regardless of
      // `dialogYear` (only capped by [max], not pinned to that year), so
      // the saved/updated entry isn't guaranteed to still belong in the
      // CURRENTLY filtered grid (an edit could move it to a different
      // year). Re-fetching by dialogYear is what stays correct either
      // way, at the cost of one extra (already-cached, near-instant)
      // service call.
      this.refetch();
      this.applyRowToForm();
    });
  }

  closeDialog(): void {
    this.dialogRef?.close();
  }

  // Backs the grid's own Delete column — confirm() first (a real delete,
  // not reversible in this mock any more than a real one would be),
  // then the mock DELETE call (commentsService.delete()) and a re-fetch
  // rather than a local splice, same "stay correct, not just locally
  // consistent" reasoning save()'s own re-fetch comment gives.
  private deleteRow(row: CircularChartComment): void {
    if (!window.confirm(`Delete this comment (${row.desc || row.spec})?`)) {
      return;
    }
    this.commentsService.delete(row.id).subscribe(() => this.refetch());
  }

  private toIsoDate(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
}
