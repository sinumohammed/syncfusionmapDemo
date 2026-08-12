// Config schema for nx-donut — deliberately independent of nx-map's own
// model/DataSource types (see nx-donut.component.ts's own header comment):
// this component only needs to know which map sub-layer group id a donut
// represents so a click can tell the host what to ask the map for. It has
// no idea what a "sub-layer" or "marker" actually is.

export interface DonutSlice {
  // Slice label, also used as the pie's xName value and tooltip text.
  x: string;
  y: number;
  color?: string;
}

// One donut's own configuration — everything NxDonutComponent needs to
// render a single card. Independently configurable per the collection's own
// `donuts` list (see DonutCollectionConfig below) — each entry can be
// inline, or fetched from a file/API on its own, same as a map layer.
export interface DonutConfig {
  // Unique across the whole collection — used both as the *ngFor identity
  // and to build the DOM id Syncfusion needs per chart instance (colliding
  // ids break Syncfusion's chart instances).
  id: string;
  label: string;
  // e.g. "40%" — Syncfusion's own string-percentage format, unset renders a
  // solid pie instead of a donut.
  innerRadius?: string;
  data: DonutSlice[];
  // Sub-layer group id(s) on the map this donut represents — emitted
  // verbatim on click (defaults to [id] when unset), see
  // NxDonutCollectionComponent.onDonutSelected(). Not read by the chart.
  sublayerIds?: string[];
}

// A value that's either hardcoded inline, loaded from a static file, or
// fetched from a live API — same three interchangeable sources nx-map uses
// for its own config (see nx-map-model.ts's DataSource<T>), reimplemented
// here independently rather than imported, per this component's own "shares
// nothing with nx-map" design.
export interface DonutDataSource<T> {
  source: "inline" | "file" | "api";
  value?: T; // required when source === "inline"
  url?: string; // required when source === "file" | "api" (HttpClient.get either way)
}

// Top-level collection config — NxDonutCollectionComponent resolves each
// entry (independently inline/file/api) into a DonutConfig, then renders one
// <app-nx-donut> per resolved entry, looping purely off this array's length.
// The collection's OWN config (this whole object) is typically supplied
// inline from a bundled JSON file by the host (see AppComponent), but
// there's nothing stopping a host from fetching this shape itself first and
// only handing the resolved DonutConfig[] in — NxDonutCollectionComponent
// accepts either via its `config`/`configSource` inputs.
export interface DonutCollectionConfig {
  donuts: DonutDataSource<DonutConfig>[];
}

// Emitted by NxDonutCollectionComponent on a card click — everything the
// host needs to forward the selection to the map (or anywhere else) without
// either donut component knowing what a "sub-layer" means on the receiving
// end. `allIds` is the full set of every donut's own id(s) in this
// collection, so the receiver can tell "everything else in this filter"
// apart from "everything on the map" (e.g. nx-map's applyDonutSelectionChange()
// un-labels every OTHER id in `allIds`, leaving ids outside it — like its
// own static mol/surface groups — untouched). `slices` is the selected
// donut's own data verbatim (present only when selectedId is set) — a host
// that wants per-slice counts/colors (e.g. nx-map recoloring
// Math.round(slice.y) of a group's EXISTING markers per slice, in that
// slice's color — no new markers created) reads them straight off this.
export interface DonutSelectionEvent {
  selectedId: string | null;
  allIds: string[];
  slices?: DonutSlice[];
}
