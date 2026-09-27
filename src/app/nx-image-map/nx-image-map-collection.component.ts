import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from "@angular/core";
import { ImageMapConfig, ImageMapMarkerClickEvent, ImageMapParams, RawImageMapNode } from "./model/nx-image-map-model";
import { buildImageMapCollection } from "./services/image-map-parent-config-transform";

// One <app-nx-image-map> per entry in the host's raw collection node
// (COMPONENT_NX_MAP_IMAGE_COLLECTION, ComponentType 7125) — same role
// NxMapCollectionComponent plays for nx-map. `params` is forwarded to every
// image map, so one host selection change refetches each map's DataAPIURL.
@Component({
  selector: "app-nx-image-map-collection",
  template: `
    <div class="nx-image-map-collection">
      <app-nx-image-map
        class="nx-image-map-collection-item"
        *ngFor="let item of maps"
        [config]="item"
        [params]="params"
        (markerClick)="markerClick.emit($event)"
      ></app-nx-image-map>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        width: 100%;
      }
      .nx-image-map-collection {
        display: flex;
        flex-wrap: wrap;
        height: 100%;
        width: 100%;
      }
      .nx-image-map-collection-item {
        flex: 1 1 480px;
        min-width: 0;
        min-height: 100%;
      }
    `
  ]
})
export class NxImageMapCollectionComponent implements OnChanges {
  @Input() rawConfig?: RawImageMapNode | null;
  @Input() params?: ImageMapParams | null;

  @Output() markerClick = new EventEmitter<ImageMapMarkerClickEvent>();

  maps: ImageMapConfig[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.rawConfig) {
      this.maps = buildImageMapCollection(this.rawConfig);
    }
  }
}
