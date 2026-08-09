import { Component, Input, OnChanges, QueryList, SimpleChanges, ViewChildren } from "@angular/core";
import { forkJoin, of } from "rxjs";
import { NxMapDemoComponent } from "./nx-map-demo.component";
import { NXMapConfigService } from "./services/nx-map-config.service";
import { MapCollectionConfig } from "./model/nx-map-model";
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
// donut selection to EVERY map instance in the collection (see
// applyDonutSelection() below) — the host (app.component.ts) talks to this
// component, not to any individual NxMapDemoComponent, once more than one
// map can exist.
@Component({
  selector: "app-nx-map-collection",
  template: `
    <div class="nx-map-collection">
      <app-nx-map-demo
        class="nx-map-collection-item"
        *ngFor="let item of maps; let i = index"
        [parentConfig]="item"
      ></app-nx-map-demo>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        width: 100%;
      }
      /* Wraps to a new row past one map's worth of width rather than
         squeezing every item into a single row — reasonable default for an
         unknown/variable item count; a single-item collection (today's
         only real config) just fills the pane exactly as the old direct
         <app-nx-map-demo> binding did. */
      .nx-map-collection {
        display: flex;
        flex-wrap: wrap;
        height: 100%;
        width: 100%;
      }
      .nx-map-collection-item {
        flex: 1 1 480px;
        min-width: 0;
        min-height: 100%;
      }
    `
  ]
})
export class NxMapCollectionComponent implements OnChanges {
  // No bundled default (same reasoning as NxMapDemoComponent.parentConfig)
  // — the host supplies its own collection config, e.g. app.component.ts
  // wrapping its existing single real-parent-config.json as a one-item
  // collection.
  @Input() config?: MapCollectionConfig<RawLayerNode>;

  maps: RawLayerNode[] = [];

  // One NxMapDemoComponent instance per `maps` entry, in DOM order — used
  // purely to broadcast a donut selection to all of them (see
  // applyDonutSelection() below), never to distinguish one map from
  // another.
  @ViewChildren(NxMapDemoComponent) private mapComponents!: QueryList<NxMapDemoComponent>;

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

  // Forwards a donut card's selection to EVERY map in this collection —
  // called by the host (app.component.ts), which has no other way to reach
  // into however many NxMapDemoComponent instances this collection ends up
  // rendering. See NxMapDemoComponent.applyDonutSelection() for what each
  // one does with it; a map whose own data has no points carrying the
  // selected metric simply does nothing, same as today's single-map case.
  applyDonutSelection(selectedId: string | null, universeIds: string[], slices?: { x: string; y: number; color?: string }[]): void {
    this.mapComponents?.forEach(m => m.applyDonutSelection(selectedId, universeIds, slices));
  }
}
