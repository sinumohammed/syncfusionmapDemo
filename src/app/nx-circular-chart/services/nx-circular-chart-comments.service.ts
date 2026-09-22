import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable } from "rxjs";
import { map, shareReplay } from "rxjs/operators";
import { CircularChartComment } from "../model/nx-circular-chart-comment-model";

const COMMENTS_URL = "assets/mock-api/circular-chart-comments.json";

// Same split as NxCircularChartConfigService's own comment — the "+" dialog's
// component stays free of HttpClient itself. Unlike that service, this one
// has to fake a WRITE path too (save()) since there's no real backend for
// this demo, so it also owns an in-memory array, seeded once from the mock
// JSON below.
@Injectable()
export class NxCircularChartCommentsService {
  private nextId = 1;

  // Loads COMMENTS_URL exactly ONCE, cached via shareReplay(1) — every
  // getByYear()/save() call shares this same in-flight/completed request
  // instead of re-fetching, and seeds `this.entries`/`this.nextId` off
  // whatever it resolves to, exactly once. This is a READINESS GATE ONLY —
  // every consumer below reads `this.entries` itself inside its own map()
  // callback, NEVER the value loaded$ emits. shareReplay(1) caches and
  // replays that emitted VALUE verbatim on every subsequent subscription —
  // confirmed live, filtering off it directly (`entries => entries.filter(...)`,
  // the first version of getByYear() below) meant every call after the
  // very first saw the same frozen snapshot from the instant the seed
  // JSON loaded, completely blind to anything save() pushed into
  // `this.entries` afterward: a save() call visibly ran (its own
  // subscribe callback fired, the dialog's form reset) but the row never
  // appeared in the grid, because getByYear()'s NEXT call was still
  // filtering the stale, pre-save snapshot.
  private readonly loaded$: Observable<CircularChartComment[]> = this.http.get<CircularChartComment[]>(COMMENTS_URL).pipe(
    map(seed => {
      this.entries = seed;
      this.nextId = seed.reduce((max, e) => Math.max(max, e.id), 0) + 1;
      return this.entries;
    }),
    shareReplay(1)
  );

  private entries: CircularChartComment[] = [];

  constructor(private http: HttpClient) {}

  // Client-side filter, same "mock a real API" spirit as this repo's other
  // static-file mocks (trend-response.json, real-circular-chart-parent-
  // config.json) — no server-side query param to filter with here, so
  // every call re-derives the year from each entry's own `date` (see
  // CircularChartComment.date's own comment on why that's never a
  // separately stored field). Filters `this.entries` (the live field),
  // NOT loaded$'s own emitted value — see loaded$'s own comment for why
  // that distinction is load-bearing, not stylistic.
  getByYear(year: number): Observable<CircularChartComment[]> {
    return this.loaded$.pipe(map(() => this.entries.filter(e => new Date(e.date).getFullYear() === year)));
  }

  // Simulated POST — ensures the seed is loaded first (so a save() that
  // races ahead of the very first getByYear() still lands in the same
  // array, not a still-empty one), assigns the next id, and returns the
  // saved row via a fresh array reference (NOT entries.push() mutating in
  // place) so any consumer relying on reference equality (e.g. rebuilding
  // an Angular @Input array) sees the change.
  save(entry: Omit<CircularChartComment, "id">): Observable<CircularChartComment> {
    return this.loaded$.pipe(
      map(() => {
        const saved: CircularChartComment = { ...entry, id: this.nextId++ };
        this.entries = [...this.entries, saved];
        return saved;
      })
    );
  }

  // Simulated PUT — mock only (no real backend, same as save()/this whole
  // service): replaces the entry at `id` outright rather than merging
  // field-by-field, since there's no partial-update semantics to honor
  // here.
  update(id: number, entry: Omit<CircularChartComment, "id">): Observable<CircularChartComment> {
    return this.loaded$.pipe(
      map(() => {
        const updated: CircularChartComment = { ...entry, id };
        this.entries = this.entries.map(e => (e.id === id ? updated : e));
        return updated;
      })
    );
  }

  // Simulated DELETE — mock only, same reasoning as save()/update().
  delete(id: number): Observable<void> {
    return this.loaded$.pipe(
      map(() => {
        this.entries = this.entries.filter(e => e.id !== id);
      })
    );
  }
}
