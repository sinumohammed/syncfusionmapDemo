import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from "@angular/core";
import { AccumulationChart, AccumulationSeriesModel, AccumulationTooltip, PieSeries } from "@syncfusion/ej2-angular-charts";
import { CircularChartConfig, CircularChartTypes, DEFAULT_PALETTE } from "./model/nx-circular-chart-model";

// Same registration pattern as nx-map-demo.component.ts's Maps.Inject(...)
// — only the pieces this component actually renders (pie series, its
// tooltip; no legend component needed — a shared legend, if the host wants
// one, belongs in NxCircularChartCollectionComponent, not repeated per card).
// AccumulationDataLabel is deliberately NOT injected — see buildSeries()'s
// own comment on why this component draws its own value badges instead of
// using Syncfusion's.
AccumulationChart.Inject(PieSeries, AccumulationTooltip);

// Shared by buildSeries() (the real Syncfusion pie's own `radius`) AND
// emptyRingSize() below (the CSS placeholder's diameter) — see
// emptyRingSize()'s own comment for why both need to agree on this.
const DEFAULT_RADIUS_PERCENT = 80;
// .nx-circular-chart-empty-ring/the real <ejs-accumulationchart> both sit in the
// same 130px-square box (see that chart's own height="130px" width="100%"
// in the template, and .nx-circular-chart-empty-ring's own comment).
const CHART_BOX_PX = 130;
// Must match .nx-circular-chart-empty-ring's own CSS border-width exactly —
// read by healthyInnerSizePx() below to size the healthy fill to this
// ring's own actual hole, not an approximate percentage of it (see that
// getter's own comment).
const EMPTY_RING_BORDER_PX = 14;
// -45° = up-and-right, standard "notification dot" position on a round
// avatar/ring — read by healthyCheckPosition() below.
const HEALTHY_CHECK_ANGLE_RAD = -Math.PI / 4;

// Fallback when a circular chart's own config.tooltipFormat (RawCircularChartNode.TooltipFormat
// in real-circular-chart-parent-config.json) is unset — same Syncfusion placeholder
// syntax, used verbatim as AccumulationTooltipSettingsModel.format either way.
const DEFAULT_TOOLTIP_FORMAT = "${point.x}: ${point.y}";

// Fallback when a healthy card's own config.healthyLabel (RawCircularChartNode.Label)
// is unset/empty — see healthyText's own comment.
const DEFAULT_HEALTHY_TEXT = "Healthy";

// A plain-HTML value badge this component draws itself, positioned from the
// chart's own (reliable) point angle — see buildSeries()'s comment for why.
interface CircularChartBadge {
  text: string;
  left: number;
  top: number;
}

// One <linearGradient> the template renders into an inline <svg><defs>,
// referenced from a point's own `color` as `url(#id)` — see buildSeries()'s
// own comment for why config.applyGradient needs this rather than a Syncfusion
// built-in (there isn't one).
interface CircularChartGradientStop {
  id: string;
  from: string;
  to: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map(c => c + c).join("") : clean;
  const value = parseInt(full, 16) || 0;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

// Blends `hex` toward `target` by `amount` (0-1) — used below to derive a
// gradient's own lighter (toward white) and darker (toward black) stop from
// one slice's own resolved base color, rather than requiring two separate
// colors from config.
function blend(hex: string, target: [number, number, number], amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([r + (target[0] - r) * amount, g + (target[1] - g) * amount, b + (target[2] - b) * amount]);
}

// Single circular chart card — one Syncfusion accumulation chart plus a centered
// label and this component's own value badges. Deliberately dumb/
// presentational: it renders whatever `config` it's given and emits
// `select` on a click anywhere on the card; it has no idea it's one of a
// list, what a "sub-layer" is, or what happens after a click — that's
// NxCircularChartCollectionComponent's job (see nx-circular-chart-collection.component.ts).
// Sibling to nx-map, sharing nothing with it: own module, own config
// schema, own Syncfusion package (ej2-angular-charts vs. ej2-angular-maps).
@Component({
  selector: "app-nx-circular-chart",
  templateUrl: "./nx-circular-chart.component.html",
  styleUrls: ["./nx-circular-chart.component.scss"],
  // Safe here specifically because every template-bound property this
  // component mutates (series/badges/centerLabelPosition/gradients) only
  // changes from ngOnChanges (driven by the config/selected @Inputs below,
  // reassigned fresh by the collection's *ngFor each rebuild) or from
  // onChartLoaded() — fired by this component's OWN (loaded) binding in its
  // template, one of the cases OnPush still checks automatically. No
  // outside timer/subscription pokes at this component's state the way
  // NxMapDemoComponent's setTimeout/subscribe chains do, so there's nothing
  // here that would go stale under OnPush.
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NxCircularChartComponent implements OnChanges {
  // Exposed so the template can compare against it directly (Angular
  // templates can't reference an imported enum on their own) — see
  // .nx-circular-chart-empty-ring's own template binding for why the empty
  // placeholder needs to know Pie vs. Doughnut vs. SemiCircle too, not just
  // isEmpty.
  readonly CircularChartTypes = CircularChartTypes;

  // A single merged CircularChartConfig — NxCircularChartCollectionComponent already builds
  // one fully-resolved object per circular chart (buildCircularChartConfigs()), data included,
  // so there's no separate values source left to split out at THIS
  // boundary — unlike NxCircularChartCollectionComponent's own rawConfig/
  // trendResponse inputs, which really do come from two different places
  // upstream (see that component's own comment).
  @Input() config?: CircularChartConfig;
  @Input() selected = false;

  // Fired on a click anywhere on the card — no payload, since the
  // collection component already has this circular chart's own config/id in scope
  // (it's iterating `circularCharts` when it binds `[config]` here in the first
  // place) and knows what to do with a selection; this component doesn't
  // need to know what a "sub-layer" is to report "I was clicked".
  @Output() select = new EventEmitter<void>();

  series: AccumulationSeriesModel[] = [];
  badges: CircularChartBadge[] = [];
  // Positions .nx-circular-chart-center from Syncfusion's own pieModule.center
  // (see onChartLoaded()'s own comment) instead of the template's CSS
  // 50%/50% default — for a full Pie/Doughnut those are the same point, but
  // a SemiCircle's own visible arc doesn't fill the box symmetrically, and
  // Syncfusion recenters it accordingly; the CSS default left the label
  // sitting right against the ring's own straight edge for that case.
  // null (ngOnChanges' own reset, before this render's first `loaded`
  // fires) falls back to that CSS default.
  centerLabelPosition: { left: number; top: number } | null = null;
  // Rendered by the template into an inline <svg><defs> ahead of
  // <ejs-accumulationchart> — see buildSeries()'s own comment. Empty
  // whenever config.applyGradient is unset/false (the existing flat-color path).
  gradients: CircularChartGradientStop[] = [];

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
    return `nx-circular-chart-${this.config?.id ?? "unknown"}`;
  }

  // True when there's no POSITIVE reading anywhere in this chart's own
  // slices — every slice is either an explicit 0 or a genuinely missing
  // (null) reading. A real Syncfusion pie has nothing to divide up in
  // either case (a slice with a real >0 value alongside some 0/null
  // siblings still renders fine — those siblings just draw as zero-width
  // wedges, "as-is", same as before this got split out), so isEmpty below
  // covers both this AND isAllZero.
  private get hasNoPositiveValue(): boolean {
    return !!this.config && !this.config.data.some(d => (d.y ?? 0) > 0);
  }

  // True when every slice has an explicit 0 reading, with NO nulls and no
  // empty data array — real, COMPLETE data, it just happens to sum to zero
  // (e.g. "zero incidents" is real data; "all normal" is a different,
  // non-zero-summing case: one slice at 0, the other at the full count,
  // rendering as an ordinary 100%-filled pie same as any other split).
  get isAllZero(): boolean {
    return !!this.config && this.config.data.length > 0 && this.config.data.every(d => d.y === 0);
  }

  // True whenever this chart has no positive reading anywhere AND isn't the
  // CONFIRMED-all-zero case above — an empty data array, an all-null chart,
  // or a mix of 0s and nulls with no positives at all (some readings came
  // back, others are still missing — not enough to confirm "genuinely all
  // zero"). Any of these renders the plain grey "No data" placeholder,
  // never the zeroAsHealthy badge, regardless of that config's own setting
  // (see isHealthy's own comment) — a real >0 reading alongside some 0/null
  // siblings is NEITHER of these two states; those siblings just draw as
  // zero-width wedges in the real chart, "as-is".
  get isNoData(): boolean {
    return this.hasNoPositiveValue && !this.isAllZero;
  }

  // Either kind of "nothing for Syncfusion's pie series to actually divide
  // up" — isNoData OR isAllZero. ngOnChanges() below skips building a
  // series for it entirely and the template swaps in
  // .nx-circular-chart-empty-ring instead; which of the two it actually is
  // then decides that ring's own text/badge (see the template's own
  // isNoData/isHealthy bindings).
  get isEmpty(): boolean {
    return this.isNoData || this.isAllZero;
  }

  // Opt-in reinterpretation of isAllZero (config.zeroAsHealthy — see its own
  // comment for why this has to be a per-card config choice rather than
  // automatic) — an all-zero reading for a metric like "incidents" means
  // "genuinely healthy, zero to report". Deliberately keyed off isAllZero,
  // NOT isEmpty/isNoData: a genuinely missing reading must never render as
  // "healthy" just because config.zeroAsHealthy happens to be set — that
  // badge only ever means "we heard back, and the answer was zero". The
  // template swaps in a green checkmark badge instead of the "No data"
  // empty-ring for this case, see .nx-circular-chart-healthy's own comment.
  get isHealthy(): boolean {
    return this.isAllZero && !!this.config?.zeroAsHealthy;
  }

  // config.healthyLabel (RawCircularChartNode.Label — see its own comment
  // for why this generic field, not a new circular-chart-specific one)
  // overrides DEFAULT_HEALTHY_TEXT when set; trimmed/empty falls through to
  // that default, same as every other per-card text override in this
  // component (tooltipFormat, etc.).
  get healthyText(): string {
    return this.config?.healthyLabel?.trim() || DEFAULT_HEALTHY_TEXT;
  }

  // Same default as buildSeries()'s own `chartType` local — used by the
  // template both for the empty placeholder's own shape (so isEmpty
  // toggling on/off, e.g. a live trend refresh, never flips the card's
  // shape) AND to reposition .nx-circular-chart-center for a real,
  // populated SemiCircle render (see that class's own comment).
  get chartType(): CircularChartTypes {
    return this.config?.chartType ?? CircularChartTypes.Doughnut;
  }

  // .nx-circular-chart-empty-ring is a plain CSS border-circle, not a Syncfusion
  // series — it never went through buildSeries()'s own `radius` at all, so
  // it always rendered at a flat 130px regardless of what a real pie on
  // this same card would have used. Confirmed live: with the real chart's
  // own default reduced to 80% (see DEFAULT_RADIUS_PERCENT), that made an
  // all-zero circular chart's empty ring look visibly BIGGER than every populated
  // neighbor's actual pie — even a null/absent config.radius, since the two
  // paths were never reading the same value. Deriving this ring's own
  // diameter from the exact same config.radius (and the exact same
  // default) as buildSeries() keeps them identical regardless of which one
  // a given card ends up rendering.
  get emptyRingSizePx(): number {
    const percent = parseFloat(this.config?.radius ?? "") || DEFAULT_RADIUS_PERCENT;
    return (CHART_BOX_PX * percent) / 100;
  }

  // The healthy badge's own green background needs to be a CIRCLE sized to
  // fill this ring's own inner hole EXACTLY — not a generic pill/box behind
  // the label text, and not an approximate percentage either (confirmed
  // live: config.innerRadius's own percentage, e.g. the usual 72%, leaves a
  // visible ring of white showing between the green fill and the ring's own
  // grey border — the two were never guaranteed to agree, and never do once
  // this ring's border stops being a round percentage of a round number).
  // Deriving it straight from the ring's own actual geometry — its outer
  // diameter (emptyRingSizePx) minus its own fixed EMPTY_RING_BORDER_PX on
  // each side, same value .nx-circular-chart-empty-ring's own CSS border-width
  // uses — instead guarantees the green fill exactly meets the grey border
  // with no gap, for every chart type alike (this placeholder ring is
  // always the same hollow shape now, Pie included — see its own comment).
  get healthyInnerSizePx(): number {
    return this.emptyRingSizePx - 2 * EMPTY_RING_BORDER_PX;
  }

  // Center point (relative to the ring box's own top-left corner) for the
  // healthy checkmark badge, sitting right ON this ROUND ring's own actual
  // boundary — not its bounding box's corner. A round ring curves away from
  // its own bounding square's corner (the ring's actual edge at 45° sits
  // emptyRingSizePx/2 * (1 - cos45°) px inside that corner, ~30% of the
  // radius for a typical size here), so CSS top/right offsets anchored to
  // that corner (the previous approach) always left the badge floating
  // visibly outside the ring instead of touching it (confirmed live).
  // HEALTHY_CHECK_ANGLE_RAD (-45°, up-and-right) picks WHERE on the ring;
  // the template centers the badge exactly on this point (transform:
  // translate(-50%, -50%)), so half of it sits inside the ring's own grey
  // band and half outside — the same overlapping-the-boundary look every
  // "notification dot on a round avatar" uses.
  get healthyCheckPosition(): { left: number; top: number } {
    const radius = this.emptyRingSizePx / 2;
    return {
      left: radius + radius * Math.cos(HEALTHY_CHECK_ANGLE_RAD),
      top: radius + radius * Math.sin(HEALTHY_CHECK_ANGLE_RAD)
    };
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.config) {
      this.gradients = [];
      this.series = this.config && !this.isEmpty ? this.buildSeries(this.config) : [];
      this.badges = [];
      // See centerLabelPosition's own comment — null falls back to the
      // template's own CSS 50%/50% default until onChartLoaded() reports a
      // real one for this (possibly new) config.
      this.centerLabelPosition = null;
    }
  }

  // A slice's own tooltip (CircularChartSlice.tooltip — from the API's own
  // Data[0].ToolTip, see parent-circular-chart-config-transform.ts's buildSlices())
  // wins outright whenever it's actually set (non-empty). Otherwise falls
  // back to this circular chart's own config.tooltipFormat (RawCircularChartNode.TooltipFormat)
  // or the component default, with that POINT's own x/y substituted in —
  // same two placeholders parent-circular-chart-config-transform.ts's own
  // TooltipFormat comment documents, manually substituted here (rather than
  // left for Syncfusion's own parseTemplate()) since this needs to run once
  // per point, ahead of time, not once per series.
  private resolveTooltipText(config: CircularChartConfig, slice: CircularChartConfig["data"][number]): string {
    if (slice.tooltip?.trim()) {
      return slice.tooltip;
    }
    return (config.tooltipFormat ?? DEFAULT_TOOLTIP_FORMAT)
      .replace(/\$\{point\.x\}/g, slice.x)
      .replace(/\$\{point\.y\}/g, String(slice.y ?? 0));
  }

  private buildSeries(config: CircularChartConfig): AccumulationSeriesModel[] {
    // config.chartType (RawCircularChartNode.Type: 0/1/2, mapped by
    // mapChartType() in parent-circular-chart-config-transform.ts) — this
    // Syncfusion version's own AccumulationType only distinguishes
    // Pie/Funnel/Pyramid (no native 'Doughnut'); a doughnut IS a Pie series
    // with a non-zero innerRadius, so 'type' stays "Pie" below regardless
    // and Pie-vs-Doughnut is driven purely by innerRadius, same as before
    // Type was wired up — a 'Pie' forces innerRadius to "0%" (a hole makes
    // no sense on a solid pie) even if config.innerRadius is set.
    // 'SemiCircle' renders as an ordinary Doughnut with its
    // startAngle/endAngle pinned to a half turn instead.
    const chartType = config.chartType ?? CircularChartTypes.Doughnut;
    const isPie = chartType === CircularChartTypes.Pie;
    // config.applyGradient swaps each point's own flat `color` for a `url(#id)`
    // reference into this.gradients (rendered by the template into an
    // inline <svg><defs> ahead of the chart) — Syncfusion's own
    // pointColorMapping just hands that string straight to the SVG path's
    // fill either way, so no other change is needed for it to pick up a
    // gradient over a flat color. Each stop is derived from that same
    // point's own resolved base color (blend() toward white/black) rather
    // than requiring a second color from config.
    return [
      {
        dataSource: config.data.map((d, i) => {
          const baseColor = d.color ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length];
          let color = baseColor;
          if (config.applyGradient) {
            const id = `${this.chartElementId}-grad-${i}`;
            this.gradients.push({ id, from: blend(baseColor, [255, 255, 255], 0.35), to: blend(baseColor, [0, 0, 0], 0.15) });
            color = `url(#${id})`;
          }
          return {
            x: d.x,
            // Syncfusion's own pie math needs a real number — a null slice
            // (genuinely missing reading, see CircularChartSlice.y's own
            // comment) mixed in among otherwise-real slices renders as a
            // zero-width wedge, same as an explicit 0 would; only the
            // ALL-null/all-zero whole-chart cases (isNoData/isAllZero
            // above) get their own distinct placeholder treatment.
            y: d.y ?? 0,
            color,
            tooltip: this.resolveTooltipText(config, d)
          };
        }),
        xName: "x",
        yName: "y",
        pointColorMapping: "color",
        // See tooltipSettings' own comment — this is what actually gets
        // each point's own pre-resolved tooltip text (dataSource[i].tooltip
        // above) into Syncfusion's point.tooltip, which "${point.tooltip}"
        // then just displays as-is.
        tooltipMappingName: "tooltip",
        type: "Pie",
        innerRadius: isPie ? "0%" : config.innerRadius ?? "72%",
        // Per-circular-chart config.radius (CircularChartCardConfig, threaded from
        // RawCircularChartNode.Radius in real-circular-chart-parent-config.json) overrides
        // DEFAULT_RADIUS_PERCENT when set — see emptyRingSizePx()'s own
        // comment for why that same default (not Syncfusion's own, ~80% but
        // computed differently) has to be shared with the empty-ring
        // fallback rather than hardcoded separately in each place.
        radius: config.radius ?? `${DEFAULT_RADIUS_PERCENT}%`,
        // SemiCircle only — a full circle (Pie/Doughnut) leaves these
        // unset so Syncfusion uses its own full-turn default.
        ...(chartType === CircularChartTypes.SemiCircle ? { startAngle: 270, endAngle: 90 } : {})
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
  // midAngle/center — which render correctly even in the value range where
  // Syncfusion's built-in data label computation silently fails, see
  // buildSeries()'s comment — to place a plain badge div ourselves just
  // outside the ring at that angle. The DISTANCE itself is deliberately NOT
  // read from Syncfusion (pieModule.labelRadius/radius) — confirmed live
  // that pieModule.labelRadius sits much closer to center for a solid Pie
  // (innerRadius forced "0%", see buildSeries()'s own comment) than for a
  // Doughnut's ring, badges landing right on top of (and unreadable against)
  // the center label for Pie cards. Deriving it from this circular chart's own
  // config.radius instead — the exact same percentage buildSeries() already
  // draws the pie/doughnut itself at — keeps every chart type's badges at
  // an identical "just past the outer edge" distance regardless of that
  // Syncfusion-internal difference.
  onChartLoaded(args: any): void {
    const chart = args?.accumulation;
    const points = chart?.visibleSeries?.[0]?.points;
    const pieModule = chart?.pieSeriesModule;
    if (!points || !pieModule) {
      return;
    }
    const center = pieModule.center ?? { x: chart.availableSize.width / 2, y: chart.availableSize.height / 2 };
    // +5, not +10 — confirmed live (pieModule.radius/center read straight
    // off the rendered chart) every badge sits at an IDENTICAL distance
    // from center regardless of angle, a true circle by construction; the
    // remaining "some badges look further from the ring than others" is a
    // rectangular-badge-vs-circular-boundary effect (a badge's flat edge
    // sits flush against the ring at some angles, its corner leaves more
    // visible gap at others), not a radius error — tightening the fixed
    // offset shrinks that gap everywhere without needing per-angle math.
    const radiusPercent = parseFloat(this.config?.radius ?? "") || DEFAULT_RADIUS_PERCENT;
    const radius = (CHART_BOX_PX * radiusPercent) / 200 + 2;

    this.centerLabelPosition = { left: center.x, top: center.y };
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
