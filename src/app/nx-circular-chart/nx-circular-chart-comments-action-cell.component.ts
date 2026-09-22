import { Component } from "@angular/core";
import { ICellRendererAngularComp } from "ag-grid-angular";
import { ICellRendererParams } from "ag-grid-community";

// cellRendererParams' own extra fields (label/onClick) — set per-column in
// NxCircularChartCommentsComponent's own columnDefs (Edit/Delete both use
// this SAME renderer, distinguished only by these params).
export interface ActionCellParams extends ICellRendererParams {
  label: string;
  onClick: (data: unknown) => void;
}

// A component-based ICellRendererAngularComp, not a plain function
// returning a string/HTMLElement — a plain function cellRenderer (tried
// first, both variants) ALSO produced nothing (0 child nodes, no thrown
// error), and so did this exact component before the real fix landed:
// the actual cause was ag-grid deferring every cellRenderer's creation
// (ANY kind) onto its own internal requestAnimationFrame task queue,
// which never flushed while the grid lived inside a MatDialog's own CDK
// overlay — see [suppressAnimationFrame] on <ag-grid-angular> in
// NxCircularChartCommentsComponent's own template, the fix that actually
// resolved it. Kept as a
// real Angular component (not reverted back to a function) since it's
// ag-grid-angular's own most standard, most heavily-tested mechanism now
// that the underlying cause is fixed either way.
@Component({
  selector: "app-nx-circular-chart-comments-action-cell",
  template: `<button type="button" class="nx-circular-chart-comments-action" (click)="onClick()">{{ label }}</button>`
})
export class NxCircularChartCommentsActionCellComponent implements ICellRendererAngularComp {
  label = "";
  private params!: ActionCellParams;

  agInit(params: ActionCellParams): void {
    this.params = params;
    this.label = params.label;
  }

  // No editable content this renderer needs to react to in place — a
  // fresh agInit() on every re-render (ag-grid's own default when this
  // returns false) is simpler and correct enough here.
  refresh(): boolean {
    return false;
  }

  onClick(): void {
    this.params.onClick(this.params.data);
  }
}
