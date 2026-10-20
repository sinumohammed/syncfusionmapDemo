import { Component, EventEmitter, Input, Output } from "@angular/core";
import { dcTag } from "../../nx-lld/model/dc-tag.model";
import { LldView } from "../../nx-lld/model/nx-lld.model";
import { LldViewSelectConfig } from "../../nx-lld/nx-lld-view-select.component";

// Stands in for the host app's own header (its own module, LldHeaderModule,
// importing NxLldViewSelectModule): a title on the left, the LLD View
// dropdown on the right. Passes the dropdown's inputs in and its picked
// view out.
@Component({
  selector: "app-lld-header",
  template: `
    <header class="lld-header">
      <h2 class="lld-header-title">{{ title }}</h2>
      <app-nx-lld-view-select
        [hierarchyTags]="hierarchyTags"
        [currentUser]="currentUser"
        [config]="viewSelectConfig"
        (viewChange)="viewChange.emit($event)"
      ></app-nx-lld-view-select>
    </header>
  `,
  styles: [
    `
      .lld-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 10px 16px;
        border-bottom: 1px solid #e5e7eb;
        background: #fff;
      }
      .lld-header-title {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: #14213d;
      }
    `
  ]
})
export class LldHeaderComponent {
  @Input() title = "";
  @Input() hierarchyTags: dcTag[] | null = null;
  @Input() currentUser: string | null = null;
  @Input() viewSelectConfig: LldViewSelectConfig = { showToolbar: true };
  @Output() readonly viewChange = new EventEmitter<LldView | null>();
}
