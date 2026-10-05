import { Injectable } from "@angular/core";
import { HttpClient, HttpHeaders } from "@angular/common/http";
import { forkJoin, Observable, of, throwError } from "rxjs";
import { delay, map, mergeMap, shareReplay } from "rxjs/operators";
import { LldGroup, LldGroupWithSubGroups, LldLookups, LldSubGroup, LldView, LldViewStatus } from "../model/nx-lld.model";

// TODO(host): real endpoints not known yet. Save = add (no id) AND edit
// (with id), same URL; delete by id (a view's is a soft delete, see
// deleteView()).
export const LLD_LOOKUPS_URL = "PDOCustom/LLD/GetLookups";
export const LLD_VIEWS_URL = "PDOCustom/LLD/GetViews";
export const LLD_SAVE_VIEW_URL = "PDOCustom/LLD/SaveView";
export const LLD_DELETE_VIEW_URL = "PDOCustom/LLD/DeleteView";
export const LLD_GROUPS_URL = "PDOCustom/LLD/GetGroups";
export const LLD_SAVE_GROUP_URL = "PDOCustom/LLD/SaveGroup";
export const LLD_DELETE_GROUP_URL = "PDOCustom/LLD/DeleteGroup";
export const LLD_SAVE_SUBGROUP_URL = "PDOCustom/LLD/SaveSubGroup";
export const LLD_DELETE_SUBGROUP_URL = "PDOCustom/LLD/DeleteSubGroup";

// Demo only: this repo has no backend, so every call is answered from an
// in-memory store seeded from the mock JSON (the mock plays the server: it
// assigns ids, upserts by id, cascades deletes and rejects invalid
// sub-groups). The host app sets this to false (or removes the mock branch)
// and replaces post() with its own httpService.
const USE_MOCK = true;
const MOCK_LOOKUPS_URL = "assets/mock-api/lld-lookups.json";
const MOCK_DATA_URL = "assets/mock-api/lld-data.json";
// Simulated network time for the mock, so loaders are visible.
const MOCK_LATENCY_MS = 400;

interface LldMockData {
  views: LldView[];
  groups: LldGroup[];
  subGroups: LldSubGroup[];
}

@Injectable()
export class NxLldService {
  constructor(private http: HttpClient) {}

  // Every dropdown/checklist value in one call.
  getLookups(token: string): Observable<LldLookups> {
    if (USE_MOCK) {
      return this.mockReady$.pipe(delay(MOCK_LATENCY_MS), map(() => this.mockLookups));
    }
    return this.post<LldLookups>(LLD_LOOKUPS_URL, {}, token);
  }

  // ------------------------------------------------------------- views
  // Soft-deleted views are never returned.
  getViews(token: string): Observable<LldView[]> {
    if (USE_MOCK) {
      return this.mock(() => this.store.views.filter(v => v.status !== LldViewStatus.Deleted));
    }
    return this.post<LldView[]>(LLD_VIEWS_URL, {}, token);
  }

  // Returns the saved view (with its server id) so the page can select it.
  saveView(view: LldView, token: string): Observable<LldView> {
    if (USE_MOCK) {
      return this.mock(() => this.upsert("views", view));
    }
    return this.post<LldView>(LLD_SAVE_VIEW_URL, view, token);
  }

  // Soft delete: the server only flips the view's status to Deleted — the
  // row (and its groups/sub-groups) stays in the database, hidden from then
  // on because getViews() skips it.
  deleteView(id: number, token: string): Observable<unknown> {
    if (USE_MOCK) {
      return this.mock(() => {
        this.store.views = this.store.views.map(v => (v.id === id ? { ...v, status: LldViewStatus.Deleted } : v));
      });
    }
    return this.post<unknown>(LLD_DELETE_VIEW_URL, { id }, token);
  }

  // ------------------------------------------------------------ groups
  // One view's groups, each carrying its own sub-groups.
  getGroups(viewId: number, token: string): Observable<LldGroupWithSubGroups[]> {
    if (USE_MOCK) {
      return this.mock(() =>
        this.store.groups
          .filter(g => g.viewId === viewId)
          .map(g => ({ ...g, subGroups: this.store.subGroups.filter(s => s.groupId === g.id) }))
      );
    }
    return this.post<LldGroupWithSubGroups[]>(LLD_GROUPS_URL, { viewId }, token);
  }

  saveGroup(group: LldGroup, token: string): Observable<LldGroup> {
    if (USE_MOCK) {
      return this.mock(() => this.upsert("groups", group));
    }
    return this.post<LldGroup>(LLD_SAVE_GROUP_URL, group, token);
  }

  // Removes the group's sub-groups too.
  deleteGroup(id: number, token: string): Observable<unknown> {
    if (USE_MOCK) {
      return this.mock(() => {
        this.store.subGroups = this.store.subGroups.filter(s => s.groupId !== id);
        this.store.groups = this.store.groups.filter(g => g.id !== id);
      });
    }
    return this.post<unknown>(LLD_DELETE_GROUP_URL, { id }, token);
  }

  // --------------------------------------------------------- sub-groups
  saveSubGroup(subGroup: LldSubGroup, token: string): Observable<LldSubGroup> {
    if (USE_MOCK) {
      return this.mockReady$.pipe(
        delay(MOCK_LATENCY_MS),
        mergeMap(() => {
          const error = this.validateSubGroup(subGroup);
          return error ? throwError(() => new Error(error)) : of(this.upsert("subGroups", subGroup));
        })
      );
    }
    return this.post<LldSubGroup>(LLD_SAVE_SUBGROUP_URL, subGroup, token);
  }

  deleteSubGroup(id: number, token: string): Observable<unknown> {
    if (USE_MOCK) {
      return this.mock(() => (this.store.subGroups = this.store.subGroups.filter(s => s.id !== id)));
    }
    return this.post<unknown>(LLD_DELETE_SUBGROUP_URL, { id }, token);
  }

  // Same signature as the host app's httpService.post(url, body, token) —
  // swap this one method for it when porting.
  private post<T>(url: string, body: unknown, token: string): Observable<T> {
    const headers = token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : undefined;
    return this.http.post<T>(url, body, { headers });
  }

  // ---------------------------------------------------------------- mock
  // Seeds loaded once; each call reads the store AFTER it's ready (never the
  // replayed seed value — that snapshot would miss later saves).
  private mockLookups!: LldLookups;
  private store: LldMockData = { views: [], groups: [], subGroups: [] };
  private readonly mockReady$: Observable<unknown> = USE_MOCK
    ? forkJoin([this.http.get<LldLookups>(MOCK_LOOKUPS_URL), this.http.get<LldMockData>(MOCK_DATA_URL)]).pipe(
        map(([lookups, data]) => {
          this.mockLookups = lookups;
          this.store = data;
        }),
        shareReplay(1)
      )
    : of(null);

  private mock<T>(answer: () => T): Observable<T> {
    return this.mockReady$.pipe(delay(MOCK_LATENCY_MS), map(answer));
  }

  // What the real server does: no id -> insert with a new id; id -> replace.
  private upsert<K extends keyof LldMockData>(key: K, record: LldMockData[K][number]): LldMockData[K][number] {
    const list = this.store[key] as { id?: number | null }[];
    let saved = { ...record };
    if (record.id != null) {
      this.store[key] = list.map(r => (r.id === record.id ? saved : r)) as LldMockData[K];
    } else {
      saved = { ...record, id: list.reduce((max, r) => Math.max(max, r.id ?? 0), 0) + 1 };
      this.store[key] = [...list, saved] as LldMockData[K];
    }
    return saved;
  }

  // Server-side safety net for the popup's own rules: one type + one
  // template (of that type) per sub-group, at least one equipment, no
  // duplicates.
  private validateSubGroup(s: LldSubGroup): string | null {
    const type = this.mockLookups.subGroupTypes.find(t => t.id === s.typeId);
    if (!s.name?.trim()) {
      return "Sub-group name is required";
    }
    if (!type) {
      return "Unknown sub-group type";
    }
    if (!type.templates.some(t => t.id === s.templateId)) {
      return "Template does not belong to the selected type";
    }
    if (!s.equipmentIds?.length) {
      return "Add at least one equipment";
    }
    if (new Set(s.equipmentIds).size !== s.equipmentIds.length) {
      return "The same equipment is added more than once";
    }
    return null;
  }
}
