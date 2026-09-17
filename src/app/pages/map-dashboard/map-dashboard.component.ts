import { Component } from "@angular/core";
import * as realParentConfigJson from "../../nx-map/testing/real-parent-config.json";
import { RawLayerNode, buildMapCollectionConfig } from "../../nx-map/services/parent-config-transform";
import { MapCollectionConfig, MapCircularChartSelection } from "../../nx-map/model/nx-map-model";
import * as realCircularChartParentConfigJson from "../../nx-circular-chart/testing/real-circular-chart-parent-config.json";
import { CircularChartSelectionEvent, RawCircularChartCollectionNode } from "../../nx-circular-chart/model/nx-circular-chart-model";

// Formerly AppComponent's own body — moved here unchanged (see
// AppComponent's own comment for why a page needs this) once AppComponent
// itself became just the router shell (nav + <router-outlet>, see
// app.component.html), so this route ("/", the app's default/current page)
// keeps showing exactly what AppComponent used to render directly: the
// circular chart panel side by side with the map collection.
@Component({
  selector: "app-map-dashboard",
  templateUrl: "./map-dashboard.component.html",
  styleUrls: ["./map-dashboard.component.scss"]
})
export class MapDashboardComponent {
  mapCollectionConfig: MapCollectionConfig<RawLayerNode> = buildMapCollectionConfig(
    ((realParentConfigJson as any).default ?? realParentConfigJson) as RawLayerNode
  );
  circularChartRawConfig = ((realCircularChartParentConfigJson as any).default ?? realCircularChartParentConfigJson) as RawCircularChartCollectionNode;

  circularChartSelection: MapCircularChartSelection | null = null;

  // Carousel columns/rows for <app-nx-circular-chart-collection> itself —
  // read from its own raw config (GridColumn/GridRow) instead of being
  // hardcoded on this page's HTML. Neither one takes a fixed hardcoded
  // fallback when unset/unparseable (a fixed number would force carousel
  // paging, or leave rows short, even when everything actually fits on
  // screen) — see the three cases below.
  private readonly circularChartCount = this.circularChartRawConfig.Configuration?.length ?? 0;
  private readonly explicitCircularChartColumns = toPositiveIntOrUndefined(this.circularChartRawConfig.GridColumn);
  private readonly explicitCircularChartRows = toPositiveIntOrUndefined(this.circularChartRawConfig.GridRow);

  // GridColumn set -> use it as-is. GridColumn unset but GridRow set ->
  // derive the columns needed to lay out every chart across that many
  // rows with no leftover carousel page (ceil(count / rows), mirrors
  // circularChartRows' own math below). BOTH unset -> no dimension to
  // derive from at all, and NOT a square-grid guess either (a narrow
  // sidebar pane squished that into cramped ~135px cards, confirmed live)
  // — falls back to a single column instead, i.e. every card at the
  // pane's own full width, one below another.
  readonly circularChartColumns =
    this.explicitCircularChartColumns ??
    (this.explicitCircularChartRows ? Math.max(1, Math.ceil(this.circularChartCount / this.explicitCircularChartRows)) : 1);

  // GridRow set -> use it as-is. GridRow unset -> auto-size rows to
  // exactly however many are needed to lay out every configured chart
  // across circularChartColumns columns with no leftover carousel page —
  // ceil(itemCount / columns), same math NxCircularChartCollectionComponent
  // .totalColumns runs in reverse (see its own comment) to know how many
  // columns a given `rows` produces. With the single-column fallback above,
  // that "leftover carousel page" math would force one row per card
  // (rows = count) here too — deliberately 0 instead (see that @Input's
  // own comment: UNLIMITED/no carousel, plain CSS-grid-wrap) so a
  // single-column layout just stacks and scrolls, not paginates one card
  // at a time.
  readonly circularChartRows =
    this.explicitCircularChartRows ??
    (this.explicitCircularChartColumns ? Math.max(1, Math.ceil(this.circularChartCount / this.circularChartColumns)) : 0);

  // .app-shell's own outer grid — DefaultGridColumns is the TOTAL column
  // count of that shell (not the carousel above), config's stand-in for
  // "how many equal columns does this page's layout have". The circular
  // chart pane always claims exactly 1 of them; the map pane gets the
  // rest. Built here (not left as a literal in .scss) so the page's own
  // column split follows config instead of a hardcoded 1fr/3fr split —
  // bound via [style.grid-template-columns] in the template.
  private readonly totalShellColumns = toPositiveInt(this.circularChartRawConfig.DefaultGridColumns, 4);
  readonly appShellGridTemplateColumns = `minmax(0, 1fr) minmax(0, ${Math.max(1, this.totalShellColumns - 1)}fr)`;

  onSublayersSelected(selection: CircularChartSelectionEvent): void {
    this.circularChartSelection = selection;
  }
}

// Config's grid fields arrive as string | number | null|undefined (real
// upstream payloads send them as strings, e.g. "4") — tolerant-parse here
// the same way parseTooltipFormat()/parseSeriesPalette() elsewhere in this
// codebase tolerate a malformed optional field: anything that doesn't
// parse to a positive integer falls back to `fallback` rather than
// producing NaN/0 columns.
function toPositiveInt(value: string | number | null | undefined, fallback: number): number {
  return toPositiveIntOrUndefined(value) ?? fallback;
}

// Same tolerant-parse as toPositiveInt(), but for callers (circularChartRows)
// that need to tell "config left this unset" apart from "config set it to
// some fixed number" and compute their own fallback rather than take a
// fixed one.
function toPositiveIntOrUndefined(value: string | number | null | undefined): number | undefined {
  const parsed = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
