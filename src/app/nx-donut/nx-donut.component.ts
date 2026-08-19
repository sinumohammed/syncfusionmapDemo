import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from "@angular/core";
import { AccumulationChart, AccumulationSeriesModel, AccumulationTooltip, PieSeries } from "@syncfusion/ej2-angular-charts";
import { DonutConfig } from "./model/nx-donut-model";

// Same registration pattern as nx-map-demo.component.ts's Maps.Inject(...)
// — only the pieces this component actually renders (pie series, its
// tooltip; no legend component needed — a shared legend, if the host wants
// one, belongs in NxDonutCollectionComponent, not repeated per card).
// AccumulationDataLabel is deliberately NOT injected — see buildSeries()'s
// own comment on why this component draws its own value badges instead of
// using Syncfusion's.
AccumulationChart.Inject(PieSeries, AccumulationTooltip);

// Default palette, cycled by slice index when a DonutSlice doesn't set its
// own `color`.
const DEFAULT_PALETTE = ["#1f4e79", "#e07b39", "#3fae5a", "#c94a3f", "#8e5ea2", "#3fbfbf"];

// Shared by buildSeries() (the real Syncfusion pie's own `radius`) AND
// emptyRingSize() below (the CSS placeholder's diameter) — see
// emptyRingSize()'s own comment for why both need to agree on this.
const DEFAULT_RADIUS_PERCENT = 80;
// .nx-donut-empty-ring/the real <ejs-accumulationchart> both sit in the
// same 130px-square box (see that chart's own height="130px" width="100%"
// in the template, and .nx-donut-empty-ring's own comment).
const CHART_BOX_PX = 130;

// Fallback when a donut's own config.tooltipFormat (RawDonutNode.TooltipFormat
// in real-donut-parent-config.json) is unset — same Syncfusion placeholder
// syntax, used verbatim as AccumulationTooltipSettingsModel.format either way.
const DEFAULT_TOOLTIP_FORMAT = "${point.x}: ${point.y}";

// A plain-HTML value badge this component draws itself, positioned from the
// chart's own (reliable) point angle — see buildSeries()'s comment for why.
interface DonutBadge {
  text: string;
  left: number;
  top: number;
}

// Single donut card — one Syncfusion accumulation chart plus a centered
// label and this component's own value badges. Deliberately dumb/
// presentational: it renders whatever `config` it's given and emits
// `select` on a click anywhere on the card; it has no idea it's one of a
// list, what a "sub-layer" is, or what happens after a click — that's
// NxDonutCollectionComponent's job (see nx-donut-collection.component.ts).
// Sibling to nx-map, sharing nothing with it: own module, own config
// schema, own Syncfusion package (ej2-angular-charts vs. ej2-angular-maps).
@Component({
  selector: "app-nx-donut",
  templateUrl: "./nx-donut.component.html",
  styleUrls: ["./nx-donut.component.scss"]
})
export class NxDonutComponent implements OnChanges {
  // A single merged DonutConfig — NxDonutCollectionComponent already builds
  // one fully-resolved object per donut (buildDonutConfigs()), data included,
  // so there's no separate values source left to split out at THIS
  // boundary — unlike NxDonutCollectionComponent's own rawConfig/
  // trendResponse inputs, which really do come from two different places
  // upstream (see that component's own comment).
  @Input() config?: DonutConfig;
  @Input() selected = false;

  // Fired on a click anywhere on the card — no payload, since the
  // collection component already has this donut's own config/id in scope
  // (it's iterating `donuts` when it binds `[config]` here in the first
  // place) and knows what to do with a selection; this component doesn't
  // need to know what a "sub-layer" is to report "I was clicked".
  @Output() select = new EventEmitter<void>();

  series: AccumulationSeriesModel[] = [];
  badges: DonutBadge[] = [];

  // Own copies, not shared across cards — confirmed live that binding every
  // <ejs-accumulationchart> to ONE shared `{ visible: false }`-style object
  // corrupts every instance after the first: Syncfusion's chart attaches
  // its own internal state directly onto whatever settings object it's
  // given. Built once here, not inline in the template — an inline object
  // literal creates a NEW reference every change-detection cycle, and
  // confirmed live that ALSO leaves charts never settling.
  //
  // format is deliberately the FIXED literal "${point.tooltip}", not
  // config.tooltipFormat directly — see resolveTooltipText()'s own comment
  // for why: Syncfusion's own AccumulationTooltip.parseTemplate() only
  // supports ONE format string per series (not per point), so this
  // component pre-resolves each point's own final tooltip text itself
  // (slice.tooltip when set, else config.tooltipFormat/the component
  // default applied to that point's own x/y) and feeds it through
  // tooltipMappingName below — this format string just has Syncfusion
  // display that already-resolved text verbatim.
  legendSettings = { visible: false };
  tooltipSettings = { enable: true, format: "${point.tooltip}", enableTextWrap: false, header: "" };
  margin = { top: 0, bottom: 0, left: 0, right: 0 };

  get chartElementId(): string {
    return `nx-donut-${this.config?.id ?? "unknown"}`;
  }

  // True when every slice is 0 — this metric has no readings at all on the
  // current map data (as opposed to "all normal", which is real data: one
  // slice at 0, the other at the full count, and renders as an ordinary
  // 100%-filled pie same as any other split). A genuinely all-zero
  // dataSource has nothing for Syncfusion's pie series to divide up, so
  // ngOnChanges() below skips building a series for it entirely and the
  // template swaps in .nx-donut-empty-ring instead.
  get isEmpty(): boolean {
    return !!this.config && this.config.data.every(d => !d.y);
  }

  // .nx-donut-empty-ring is a plain CSS border-circle, not a Syncfusion
  // series — it never went through buildSeries()'s own `radius` at all, so
  // it always rendered at a flat 130px regardless of what a real pie on
  // this same card would have used. Confirmed live: with the real chart's
  // own default reduced to 80% (see DEFAULT_RADIUS_PERCENT), that made an
  // all-zero donut's empty ring look visibly BIGGER than every populated
  // neighbor's actual pie — even a null/absent config.radius, since the two
  // paths were never reading the same value. Deriving this ring's own
  // diameter from the exact same config.radius (and the exact same
  // default) as buildSeries() keeps them identical regardless of which one
  // a given card ends up rendering.
  get emptyRingSizePx(): number {
    const percent = parseFloat(this.config?.radius ?? "") || DEFAULT_RADIUS_PERCENT;
    return (CHART_BOX_PX * percent) / 100;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.config) {
      this.series = this.config && !this.isEmpty ? this.buildSeries(this.config) : [];
      this.badges = [];
    }
  }

  // A slice's own tooltip (DonutSlice.tooltip — from the API's own
  // Data[0].ToolTip, see parent-donut-config-transform.ts's buildSlices())
  // wins outright whenever it's actually set (non-empty). Otherwise falls
  // back to this donut's own config.tooltipFormat (RawDonutNode.TooltipFormat)
  // or the component default, with that POINT's own x/y substituted in —
  // same two placeholders parent-donut-config-transform.ts's own
  // TooltipFormat comment documents, manually substituted here (rather than
  // left for Syncfusion's own parseTemplate()) since this needs to run once
  // per point, ahead of time, not once per series.
  private resolveTooltipText(config: DonutConfig, slice: DonutConfig["data"][number]): string {
    if (slice.tooltip?.trim()) {
      return slice.tooltip;
    }
    return (config.tooltipFormat ?? DEFAULT_TOOLTIP_FORMAT)
      .replace(/\$\{point\.x\}/g, slice.x)
      .replace(/\$\{point\.y\}/g, String(slice.y));
  }

  private buildSeries(config: DonutConfig): AccumulationSeriesModel[] {
    return [
      {
        dataSource: config.data.map((d, i) => ({
          x: d.x,
          y: d.y,
          color: d.color ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
          tooltip: this.resolveTooltipText(config, d)
        })),
        xName: "x",
        yName: "y",
        pointColorMapping: "color",
        // See tooltipSettings' own comment — this is what actually gets
        // each point's own pre-resolved tooltip text (dataSource[i].tooltip
        // above) into Syncfusion's point.tooltip, which "${point.tooltip}"
        // then just displays as-is.
        tooltipMappingName: "tooltip",
        innerRadius: config.innerRadius ?? "72%",
        // Per-donut config.radius (DonutCardConfig, threaded from
        // RawDonutNode.Radius in real-donut-parent-config.json) overrides
        // DEFAULT_RADIUS_PERCENT when set — see emptyRingSizePx()'s own
        // comment for why that same default (not Syncfusion's own, ~80% but
        // computed differently) has to be shared with the empty-ring
        // fallback rather than hardcoded separately in each place.
        radius: config.radius ?? `${DEFAULT_RADIUS_PERCENT}%`
        // No `dataLabel` here — Syncfusion 29.2's AccumulationDataLabel
        // module (Outside AND Inside position alike) leaves labelRegion
        // permanently null for roughly a 25%-32%/68%-75% two-point split,
        // confirmed live by mutating a rendered chart's dataSource directly
        // in the console and inspecting visibleSeries[0].points — same
        // failure regardless of stable object references, so it isn't an
        // Angular-binding issue. onChartLoaded() below draws our own value
        // badges instead, positioned from point.midAngle (which stays
        // correct in every case tested), sidestepping the bug entirely.
      }
    ];
  }

  // Fires after every render/refresh (Syncfusion's public `loaded` event —
  // EmitType<IAccLoadedEventArgs>, `any` here since @syncfusion/ej2-angular-charts
  // doesn't re-export that interface name). Reads each point's own
  // midAngle/center/radius — which render correctly even in the value range
  // where Syncfusion's built-in data label computation silently fails, see
  // buildSeries()'s comment — to place a plain badge div ourselves just
  // outside the ring at that angle.
  onChartLoaded(args: any): void {
    const chart = args?.accumulation;
    const points = chart?.visibleSeries?.[0]?.points;
    const pieModule = chart?.pieSeriesModule;
    if (!points || !pieModule) {
      return;
    }
    const center = pieModule.center ?? { x: chart.availableSize.width / 2, y: chart.availableSize.height / 2 };
    const radius = (pieModule.labelRadius ?? pieModule.radius ?? Math.min(chart.availableSize.width, chart.availableSize.height) / 2) + 10;

    this.badges = points.map((p: any) => {
      const radians = (p.midAngle * Math.PI) / 180;
      return {
        text: this.formatValue(p.y),
        left: center.x + radius * Math.cos(radians),
        top: center.y + radius * Math.sin(radians)
      };
    });
  }

  private formatValue(value: number): string {
    return Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }
}
