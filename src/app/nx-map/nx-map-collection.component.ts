import { Component, Input, OnChanges, SimpleChanges } from "@angular/core";
import { forkJoin, of } from "rxjs";
import { NXMapConfigService } from "./services/nx-map-config.service";
import { MapCollectionConfig, MapDonutSelection } from "./model/nx-map-model";
import { RawLayerNode } from "./services/parent-config-transform";

// Iterates NxMapDemoComponent — one <app-nx-map-demo> per entry in
// `config.maps`, purely off that array's length/content, not a fixed count.
// Each entry is its own DataSource<RawLayerNode>: inline, or fetched
// independently from a file/API, same as NxDonutCollectionComponent does for
// its own `donuts` (see nx-donut-collection.component.ts) — reusing
// NXMapConfigService.resolve() here rather than duplicating it, since this
// lives inside nx-map's own module already (unlike nx-donut, which
// deliberately keeps its own independent copy).
//
// Owns the one thing that only makes sense collection-wide: forwarding a
// donut selection to EVERY map instance in the collection — purely by
// re-binding its own `donutSelection` @Input straight through onto every
// <app-nx-map-demo> in the template (see nx-map-collection.component.html),
// same as `maps` itself flows down. The host (app.component.ts) only ever
// sets THIS component's `donutSelection` Input; it never reaches into an
// individual NxMapDemoComponent.
@Component({
  selector: "app-nx-map-collection",
  templateUrl: "./nx-map-collection.component.html",
  styleUrls: ["./nx-map-collection.component.scss"]
})
export class NxMapCollectionComponent implements OnChanges {
  // No bundled default (same reasoning as NxMapDemoComponent.parentConfig)
  // — the host supplies its own collection config, e.g. app.component.ts
  // wrapping its existing single real-parent-config.json as a one-item
  // collection.
  @Input() config?: MapCollectionConfig<RawLayerNode>;

  // Passed straight through onto every <app-nx-map-demo>'s own
  // donutSelection @Input in the template — see NxMapDemoComponent.
  // donutSelection's own comment for what a change here actually does; a
  // map whose own data has no points carrying the selected metric simply
  // does nothing, same as today's single-map case.
  @Input() donutSelection?: MapDonutSelection | null;

  maps: RawLayerNode[] = [];

  constructor(private configService: NXMapConfigService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes.config) {
      return;
    }
    const sources = this.config?.maps ?? [];
    const resolved$ = sources.length ? forkJoin(sources.map(s => this.configService.resolve(s))) : of([]);
    resolved$.subscribe(maps => {
      this.maps = maps;
    });
  }
}
