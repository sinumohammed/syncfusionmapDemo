import { Component } from "@angular/core";
import { ICellRendererAngularComp } from "ag-grid-angular";
import { ICellRendererParams } from "ag-grid-community";

// cellRendererParams for the actions column — what Edit / Delete do with
// the row's data.
export interface LldRowActionsCellParams<T = unknown> extends ICellRendererParams {
  editLabel?: string;
  deleteLabel?: string;
  onEdit: (row: T) => void;
  onDelete: (row: T) => void;
}

// An AG Grid row's Edit / Delete icons (the Groups tab's grid).
@Component({
  selector: "app-nx-lld-row-actions-cell",
  template: `
    <span class="nx-lld-row-actions-cell">
      <button mat-icon-button type="button" [matTooltip]="editLabel" [attr.aria-label]="editLabel" (click)="edit()">
        <svg viewBox="0 0 24 24" class="nx-lld-icon">
          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
        </svg>
      </button>
      <button mat-icon-button type="button" class="nx-lld-delete" [matTooltip]="deleteLabel" [attr.aria-label]="deleteLabel" (click)="remove()">
        <svg viewBox="0 0 24 24" class="nx-lld-icon">
          <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
        </svg>
      </button>
    </span>
  `,
  styles: [
    `
      .nx-lld-row-actions-cell {
        display: inline-flex;
        align-items: center;
        height: 100%;
      }
      .mat-icon-button {
        width: 32px;
        height: 32px;
        line-height: 32px;
      }
      .nx-lld-icon {
        width: 18px;
        height: 18px;
        fill: currentColor;
        vertical-align: middle;
      }
      .nx-lld-delete {
        color: #d32f2f;
      }
    `
  ]
})
export class NxLldRowActionsCellComponent implements ICellRendererAngularComp {
  editLabel = "Edit";
  deleteLabel = "Delete";
  private params!: LldRowActionsCellParams;

  agInit(params: LldRowActionsCellParams): void {
    this.params = params;
    this.editLabel = params.editLabel ?? "Edit";
    this.deleteLabel = params.deleteLabel ?? "Delete";
  }

  refresh(): boolean {
    return false;
  }

  edit(): void {
    this.params.onEdit(this.params.data);
  }

  remove(): void {
    this.params.onDelete(this.params.data);
  }
}
