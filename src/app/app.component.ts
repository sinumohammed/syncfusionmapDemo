import { Component } from "@angular/core";
import * as realParentConfigJson from "./nx-map/testing/real-parent-config.json";
import { RawLayerNode } from "./nx-map/services/parent-config-transform";

// Standalone-demo stand-in for a real host application binding its own
// widget payload onto NxMapDemoComponent's parentConfig @Input — the
// component itself has no bundled default to fall back on (see
// nx-map-demo.component.ts's ngOnChanges()), so something has to supply
// this for the demo to show anything when run on its own.
@Component({
  selector: "app-root",
  template: `<app-nx-map-demo [parentConfig]="parentConfig"></app-nx-map-demo>`
})
export class AppComponent {
  parentConfig = ((realParentConfigJson as any).default ?? realParentConfigJson) as RawLayerNode;
}
