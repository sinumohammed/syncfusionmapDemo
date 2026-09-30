import { Injectable } from "@angular/core";
import { HttpClient, HttpHeaders } from "@angular/common/http";
import { Observable, of } from "rxjs";
import { delay, map, shareReplay } from "rxjs/operators";
import { CircularChartComment } from "../model/nx-circular-chart-comment-model";

// Save AND edit: the same POST — a new comment is sent without `id`, an
// edit with its existing `id`; the server assigns ids, never the UI.
export const COMMENTS_SAVE_URL = "PDOCustom/EQPDashboard/SaveEQPDashboardGaugeData";
// TODO(host): real endpoints not known yet — the list is fetched the same way
// as the trend data (a POST with the year in the payload), delete by id.
export const COMMENTS_LIST_URL = "PDOCustom/EQPDashboard/GetEQPDashboardGaugeData";
export const COMMENTS_DELETE_URL = "PDOCustom/EQPDashboard/DeleteEQPDashboardGaugeData";

// Payload for the list fetch — same idea as the trend fetch's ReqPayload.
export interface CommentsListPayload {
  year: number;
}

// Demo only: this repo has no backend, so the calls below are answered from
// an in-memory list seeded from the mock JSON (the mock plays the server:
// it assigns ids and upserts by id). The host app sets this to false (or
// removes the mock branch) and replaces post() with its own httpService.
const USE_MOCK = true;
const MOCK_SEED_URL = "assets/mock-api/circular-chart-comments.json";
// Simulated network time for the mock, so the popup's loader is visible.
const MOCK_LATENCY_MS = 500;

@Injectable()
export class NxCircularChartCommentsService {
  constructor(private http: HttpClient) {}

  // The popup's history grid — every call fetches fresh from the server
  // (the popup refetches after each save/edit/delete).
  getByYear(payload: CommentsListPayload, token: string): Observable<CircularChartComment[]> {
    if (USE_MOCK) {
      return this.mockReady$.pipe(
        delay(MOCK_LATENCY_MS),
        map(() => this.mockEntries.filter(e => new Date(e.date).getFullYear() === payload.year))
      );
    }
    return this.post<CircularChartComment[]>(COMMENTS_LIST_URL, payload, token);
  }

  // Add (no id) or edit (with id) — same URL either way.
  save(payload: CircularChartComment, token: string): Observable<CircularChartComment[]> {
    if (USE_MOCK) {
      return this.mockReady$.pipe(
        delay(MOCK_LATENCY_MS),
        map(() => this.mockSave(payload))
      );
    }
    return this.post<CircularChartComment[]>(COMMENTS_SAVE_URL, payload, token);
  }

  delete(id: number, token: string): Observable<unknown> {
    if (USE_MOCK) {
      return this.mockReady$.pipe(
        delay(MOCK_LATENCY_MS),
        map(() => (this.mockEntries = this.mockEntries.filter(e => e.id !== id)))
      );
    }
    return this.post<unknown>(COMMENTS_DELETE_URL, { id }, token);
  }

  // Same signature as the host app's httpService.post(url, body, token) —
  // swap this one method for it when porting.
  private post<T>(url: string, body: unknown, token: string): Observable<T> {
    const headers = token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : undefined;
    return this.http.post<T>(url, body, { headers });
  }

  // ---------------------------------------------------------------- mock
  // Seed loaded once; each call reads mockEntries AFTER it's ready (never
  // the replayed seed value — that snapshot would miss later saves).
  private mockEntries: CircularChartComment[] = [];
  private readonly mockReady$: Observable<unknown> = USE_MOCK
    ? this.http.get<CircularChartComment[]>(MOCK_SEED_URL).pipe(
        map(seed => (this.mockEntries = seed)),
        shareReplay(1)
      )
    : of(null);

  // What the real server does: no id -> insert with a new id; id -> replace.
  private mockSave(payload: CircularChartComment): CircularChartComment[] {
    if (payload.id != null) {
      this.mockEntries = this.mockEntries.map(e => (e.id === payload.id ? { ...payload } : e));
    } else {
      const nextId = this.mockEntries.reduce((max, e) => Math.max(max, e.id ?? 0), 0) + 1;
      this.mockEntries = [...this.mockEntries, { ...payload, id: nextId }];
    }
    return this.mockEntries;
  }
}
