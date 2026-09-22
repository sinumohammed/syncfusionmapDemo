import { MatDialogConfig } from "@angular/material/dialog";

// This repo's own default for NxCircularChartCommentsComponent.openAddDialog()
// — named to echo NIBRAS_DIALOG_CONFIG from the user's other host app (same
// TemplateRef + MatDialog.open() pattern), but that constant doesn't exist
// here, so this is a locally scoped equivalent rather than a shared import.
export const DEFAULT_DIALOG_CONFIG: MatDialogConfig = {
  disableClose: false,
  autoFocus: true
};
