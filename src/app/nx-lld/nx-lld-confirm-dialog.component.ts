import { Component, Inject } from "@angular/core";
import { MAT_DIALOG_DATA } from "@angular/material/dialog";

export interface LldConfirmDialogData {
  title: string;
  message: string;
  confirmLabel?: string;
}

// Yes/no popup for every LLD delete — a Material dialog rather than the
// browser's confirm(), so it matches the rest of the screen. Closes with
// true on confirm, undefined otherwise.
@Component({
  selector: "app-nx-lld-confirm-dialog",
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <div mat-dialog-content>{{ data.message }}</div>
    <div mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-flat-button color="warn" [mat-dialog-close]="true">{{ data.confirmLabel || "Delete" }}</button>
    </div>
  `
})
export class NxLldConfirmDialogComponent {
  constructor(@Inject(MAT_DIALOG_DATA) public data: LldConfirmDialogData) {}
}
