import { Injectable } from "@angular/core";
import { HttpClient, HttpErrorResponse, HttpHeaders } from "@angular/common/http";
import { forkJoin, Observable, of, Subject, throwError } from "rxjs";
import { catchError, delay, map, mergeMap, shareReplay, tap } from "rxjs/operators";
import { dcTag } from "../model/dc-tag.model";
import {
  LldApiResult,
  LldApiStatus,
  LldGroup,
  LldGroupRequest,
  LldGroupWithSubGroups,
  LldLookups,
  LldSaveViewRequest,
  LldSubGroup,
  LldView,
  LldViewResponse,
  LldViewStatus
} from "../model/nx-lld.model";

// Real host endpoints (see getSubsurfaces() / getStations()).
export const LLD_SUBSURFACES_URL = "api/PDOCustom/GetSubSurfaceOperations";
export const LLD_STATIONS_URL = "api/PreConfig/GetStations";
// The category GetStations is always asked for.
const LLD_STATIONS_CATEGORY_ID = 1631;

// TODO(host): confirm the full path — only "/SaveLD" is known. Save = add
// (no LDID), edit (with LDID) AND delete (an edit with Status 3), same URL.
export const LLD_SAVE_VIEW_URL = "api/PDOCustom/SaveLD";
// The View dropdown, posted the same tag array as GetSubSurfaceOperations.
export const LLD_VIEWS_URL = "LimitDiagram/GetLDViews";
// The selected view's details, by LDID (see getViewDetails()).
export const LLD_VIEW_DETAILS_URL = "LimitDiagram/GetLDViewDetails";

// A view's groups (LDID, GID empty) or one group (LDID + GID) — see
// getGroups() / getGroup().
export const LLD_GROUPS_URL = "LimitDiagram/GetLDGroupDetails";
// Save = add (GroupID 0), edit (the real GroupID) AND delete (an edit with
// IsDeleted true), same URL.
export const LLD_SAVE_GROUP_URL = "LimitDiagram/SaveLDGroup";

// TODO(host): real endpoints not known yet. Save = add (no id) AND edit
// (with id), same URL; delete by id.
export const LLD_LOOKUPS_URL = "PDOCustom/LLD/GetLookups";
export const LLD_SAVE_SUBGROUP_URL = "PDOCustom/LLD/SaveSubGroup";
export const LLD_DELETE_SUBGROUP_URL = "PDOCustom/LLD/DeleteSubGroup";

// Demo only: this repo has no backend, so every call is answered from an
// in-memory store seeded from the mock JSON (the mock plays the server: it
// assigns ids, upserts by id, cascades deletes and rejects duplicate view
// and group names and invalid sub-groups). The host app sets this to false (or removes the mock branch)
// and replaces post() with its own httpService.
const USE_MOCK = true;
const MOCK_LOOKUPS_URL = "assets/mock-api/lld-lookups.json";
const MOCK_DATA_URL = "assets/mock-api/lld-data.json";
// The real GetSubSurfaceOperations response (FAHUD) plus one made-up
// subsurface ("MOCK FIELD 2"), so switching subsurface can be tried.
const MOCK_SUBSURFACES_URL = "assets/mock-api/lld-subsurfaces.json";
// GetStations responses, keyed by the subsurface's ElementVersionID.
const MOCK_STATIONS_URL = "assets/mock-api/lld-stations.json";
// Who the mock "server" stamps as a view's creator / modifier (the real API
// takes the logged-in user).
const MOCK_USER = "1337";
// Simulated network time for the mock, so loaders are visible.
const MOCK_LATENCY_MS = 400;

// The message to show for a failed call. A rejected save (e.g. "a view with
// this name already exists") comes back as an HTTP error whose body carries
// the server's own message — shown as-is.
// TODO(host): match the real error body's shape once known (the host's
// result envelope uses ErrorMessage / StatusMessage, read here too).
export function apiErrorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error;
    if (typeof body === "string" && body.trim()) {
      return body;
    }
    return body?.message || body?.Message || body?.ErrorMessage || body?.StatusMessage || err.message || "Request failed";
  }
  return (err as Error)?.message || "Request failed";
}

// Throws the server's own message when a call "succeeded" (HTTP 200) with
// Status/IsValid false — e.g. a rejected save.
function assertOk<T extends LldApiStatus>(result: T): T {
  if (!result?.Status || !result.IsValid) {
    throw new Error(result?.ErrorMessage || result?.StatusMessage || "Request failed");
  }
  return result;
}

// The payload of a host result envelope.
function unwrapResult<T>(result: LldApiResult<T>): T {
  return assertOk(result).Value;
}

// A view as SaveLD wants it. Who created / modified it isn't sent — the API
// stamps that from the logged-in user itself.
function toSaveViewRequest(view: LldView): LldSaveViewRequest {
  const request: LldSaveViewRequest = {
    LDViewName: view.name,
    LDDescription: view.description,
    SubSurfaceOperationId: view.subsurfaceId!,
    SubSurfaceOperation: view.subsurfaceName,
    Facility: view.stationNames.join(","),
    Status: view.status
  };
  return view.id != null ? { LDID: view.id, ...request } : request;
}

// A group as SaveLDGroup wants it — always the full model.
function toGroupRequest(group: LldGroup): LldGroupRequest {
  return {
    GroupID: group.id ?? 0,
    GroupName: group.name,
    LDID: group.viewId,
    GroupOrder: group.order,
    GroupDesc: group.description,
    GroupType: group.type,
    IsVisible: group.isVisible,
    IsDeleted: !!group.isDeleted
  };
}

// A GetLDGroupDetails row as the page's group.
function toGroup(row: LldGroupRequest): LldGroup {
  return {
    id: row.GroupID,
    viewId: row.LDID,
    name: row.GroupName ?? "",
    description: row.GroupDesc ?? "",
    order: row.GroupOrder ?? 0,
    type: row.GroupType || null,
    isVisible: row.IsVisible ?? true,
    isDeleted: !!row.IsDeleted
  };
}

// Groups in their display order, then by name.
function byGroupOrder(a: LldGroup, b: LldGroup): number {
  return (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name);
}

// GetLDGroupDetails' Value as rows — an array, or a single row / null when
// one group is asked for.
function groupRows(value: LldGroupRequest[] | LldGroupRequest | null): LldGroupRequest[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

// A GetLDViews row as the page's view. 0 / null user ids mean "nobody"
// (ModifiedBy is 0 on a never-edited view); Facility is the comma-separated
// station names SaveLD was given.
function toView(row: LldViewResponse): LldView {
  const user = (id: number | string | null) => (id ? String(id) : null);
  return {
    id: row.LDID,
    name: row.LDViewName,
    description: row.LDDescription ?? "",
    subsurfaceId: row.SubSurfaceOperationId || null,
    subsurfaceName: row.SubSurfaceOperation ?? "",
    stationNames: (row.Facility ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(s => s),
    status: row.Status,
    createdBy: user(row.CreatedBy),
    createdOn: row.CreatedOn ?? null,
    modifiedBy: user(row.ModifiedBy),
    modifiedOn: row.ModifiedOn ?? null
  };
}

// The subsurface tag with this name (TagName — unique), ignoring case and
// surrounding spaces. Views are matched to their subsurface by name, since
// GetLDViews / GetLDViewDetails send SubSurfaceOperationId back as 0.
export function findSubsurface(subsurfaces: dcTag[], name: string | null | undefined): dcTag | undefined {
  const key = (name ?? "").trim().toLowerCase();
  return key ? subsurfaces.find((s: dcTag) => (s.TagName ?? "").trim().toLowerCase() === key) : undefined;
}

// A view (e.g. from GetLDViewDetails) with its subsurface id filled in from
// the subsurface list by name — what Edit's popup does before saving, so a
// delete sends the same SubSurfaceOperationId an edit would.
export function withSubsurfaceId(view: LldView, subsurfaces: dcTag[]): LldView {
  const subsurface = findSubsurface(subsurfaces, view.subsurfaceName);
  return subsurface ? { ...view, subsurfaceId: subsurface.ObjectID ?? view.subsurfaceId, subsurfaceName: subsurface.TagName ?? view.subsurfaceName } : view;
}

// The picked view as the host passes it to each tab — normally
// {"LDID":[21]}, but the key name and shape aren't relied on: any of
// {"LDID":[21]}, {"id":21}, {"viewId":"21"}, [21], 21 or "21", as a JSON
// string or already parsed.
export type LldViewSelection = string | number | unknown[] | Record<string, unknown>;

// Object keys tried first, in this order (case-insensitive), before falling
// back to the object's first value.
const VIEW_ID_KEYS = ["ldid", "id", "viewid", "ld_id", "view_id"];

// The view id in a selection — the first positive number found — or null
// when there's none (empty, unparseable, nothing numeric).
export function selectedViewId(selection: LldViewSelection | null | undefined): number | null {
  return findViewId(selection, 0);
}

function findViewId(value: unknown, depth: number): number | null {
  if (value == null || depth > 3) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) {
      return null;
    }
    // A bare number ("21"), else JSON ('{"LDID":[21]}').
    if (/^\d+$/.test(text)) {
      return findViewId(Number(text), depth);
    }
    try {
      return findViewId(JSON.parse(text), depth + 1);
    } catch {
      console.error("[LLD] View selection isn't a number or valid JSON:", value);
      return null;
    }
  }
  if (Array.isArray(value)) {
    return findViewId(value[0], depth + 1);
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const known = VIEW_ID_KEYS.map(key => entries.find(([k]) => k.toLowerCase() === key)).find(entry => entry);
    return findViewId((known ?? entries[0])?.[1], depth + 1);
  }
  return null;
}

// What identifies a hierarchy selection — the cache key for its
// subsurfaces and views, and how the page spots a changed selection.
export function hierarchyKey(tags: dcTag[] | null): string {
  return (tags ?? []).map((t: dcTag) => `${t.TagID}|${t.ObjectID}|${t.TagName}`).join(",");
}

// A hierarchy tag as GetLDViews wants it: only these fields, not the whole
// dcTag (its UI flags, dataStoreOptions, etc. are left out).
export type LldViewsTag = Pick<
  dcTag,
  "TagID" | "TagName" | "ElementTypeID" | "SourceObjectID" | "ObjectID" | "isSelected" | "CategoryID" | "SourceClassID"
>;
function toViewsTag(tag: dcTag): LldViewsTag {
  return {
    TagID: tag.TagID,
    TagName: tag.TagName,
    ElementTypeID: tag.ElementTypeID,
    SourceObjectID: tag.SourceObjectID,
    ObjectID: tag.ObjectID,
    isSelected: tag.isSelected,
    CategoryID: tag.CategoryID,
    SourceClassID: tag.SourceClassID
  };
}

// One item of the GetSubSurfaceOperations / GetStations responses — only
// the fields read here.
interface ElementResponse {
  ElementName: string;
  ElementTypeID: number;
  // The identity (ElementID is 0 on every row).
  ElementVersionID: number;
  [key: string]: unknown;
}

// The host's tag for a response element: named after it, ObjectID = its
// ElementVersionID.
function toTag(element: ElementResponse): dcTag {
  return new dcTag(undefined, element.ElementName, element.ElementTypeID, element.ElementVersionID, element.ElementVersionID);
}

interface LldMockData {
  views: LldView[];
  groups: LldGroup[];
  subGroups: LldSubGroup[];
}

@Injectable()
export class NxLldService {
  constructor(private http: HttpClient) {}

  // --------------------------------------------------------- elements
  // The Subsurface dropdown. `tags` is the host's own tag selection, posted
  // as-is. Remembered per selection, so going back to an earlier one makes
  // no call.
  getSubsurfaces(tags: dcTag[], token: string): Observable<dcTag[]> {
    // TEMP: tracing why the Subsurface dropdown stays empty — remove afterwards.
    console.log("[LLD] getSubsurfaces called, cached:", this.subsurfacesCache.has(hierarchyKey(tags)), tags);
    return this.cached(this.subsurfacesCache, hierarchyKey(tags), () =>
      USE_MOCK
        ? this.mock(() => unwrapResult(this.mockSubsurfaces).map(toTag))
        : this.post<LldApiResult<ElementResponse[]>>(LLD_SUBSURFACES_URL, tags, token).pipe(
            tap((result: LldApiResult<ElementResponse[]>) => console.log("[LLD] GetSubSurfaceOperations raw result", result)),
            map((result: LldApiResult<ElementResponse[]>) => unwrapResult(result).map(toTag))
          )
    );
  }
  private readonly subsurfacesCache = new Map<string, Observable<dcTag[]>>();

  // One subsurface's stations — a separate call per subsurface, asked for
  // by its name and type only. Remembered per subsurface, so the page and
  // the View popup share one fetch; a failed fetch isn't remembered.
  getStations(subsurface: dcTag, token: string): Observable<dcTag[]> {
    const id = subsurface.ObjectID!;
    return this.cached(this.stationsCache, id, () =>
      (USE_MOCK
        ? this.mock(() => this.mockStations[id] ?? [])
        : this.post<ElementResponse[]>(
            LLD_STATIONS_URL,
            { tagName: subsurface.TagName, elementTypeID: subsurface.ElementTypeID, categoryID: LLD_STATIONS_CATEGORY_ID },
            token
          )
      ).pipe(map((stations: ElementResponse[]) => (stations ?? []).map(toTag)))
    );
  }
  private readonly stationsCache = new Map<number, Observable<dcTag[]>>();

  // ----------------------------------------------------------- lookups
  // Every Sub-group dropdown/checklist value in one call. Fetched once and
  // remembered (they rarely change) — each Sub-groups tab open reuses it.
  getLookups(token: string): Observable<LldLookups> {
    return this.cached(this.lookupsCache, "all", () =>
      USE_MOCK
        ? this.mockReady$.pipe(delay(MOCK_LATENCY_MS), map(() => this.mockLookups))
        : this.post<LldLookups>(LLD_LOOKUPS_URL, {}, token)
    );
  }
  private readonly lookupsCache = new Map<string, Observable<LldLookups>>();

  // ------------------------------------------------------------- views
  // The views of the host's hierarchy selection — each tag trimmed to the
  // fields GetLDViews takes (see toViewsTag()). Soft-deleted views are never shown (filtered here too,
  // in case the API ever returns them). The mock ignores `tags`.
  // Remembered per selection like the subsurfaces; a save or delete forgets
  // every remembered list, so the reload after it reaches the server.
  getViews(tags: dcTag[], token: string): Observable<LldView[]> {
    return this.cached(this.viewsCache, hierarchyKey(tags), () =>
      USE_MOCK
        ? this.mock(() => this.store.views.filter(v => v.status !== LldViewStatus.Deleted))
        : this.post<LldApiResult<LldViewResponse[]>>(LLD_VIEWS_URL, tags.map(toViewsTag), token).pipe(
            map(result => (unwrapResult(result) ?? []).map(toView).filter(v => v.status !== LldViewStatus.Deleted))
          )
    );
  }
  private readonly viewsCache = new Map<string, Observable<LldView[]>>();

  // The id of each view just saved (added, edited or deleted). A tab gets
  // the picked view as {"LDID":[id]}, which doesn't change when that view is
  // edited — so the tabs listen here to reload it.
  private readonly viewSavedSubject = new Subject<number | null>();
  readonly viewSaved$: Observable<number | null> = this.viewSavedSubject.asObservable();

  // Returns the saved view so the page can select it — with its server id
  // when the API reports one (SaveLD's ID can be 0; the page then finds a
  // new view by name). A rejected save, e.g. a duplicate name, comes back
  // with Status false — the popup shows its message.
  saveView(view: LldView, token: string): Observable<LldView> {
    const request = toSaveViewRequest(view);
    // TEMP: to check the SaveLD payload while testing — remove afterwards.
    console.log("[LLD] SaveLD payload", request);
    // Every remembered list is stale now, and so are this view's remembered
    // details (all of them when the save reported no id) — forgotten BEFORE
    // the tabs showing it are told to reload, so they reach the server.
    const forgetViews = tap<LldView>((saved: LldView) => {
      this.viewsCache.clear();
      if (saved.id != null) {
        this.detailsCache.delete(saved.id);
      } else {
        this.detailsCache.clear();
      }
      this.viewSavedSubject.next(saved.id ?? null);
    });
    if (USE_MOCK) {
      return this.mockReady$.pipe(
        delay(MOCK_LATENCY_MS),
        mergeMap(() => {
          const name = view.name.trim().toLowerCase();
          const duplicate = this.store.views.some(
            v => v.id !== view.id && v.status !== LldViewStatus.Deleted && v.name.trim().toLowerCase() === name
          );
          if (duplicate) {
            return mockError(409, `A view named "${view.name}" already exists`);
          }
          // The server stamps who/when: created once, modified on each edit.
          const now = new Date().toISOString();
          const existing = this.store.views.find(v => v.id === view.id);
          const stamped: LldView = existing
            ? { ...existing, ...view, createdBy: existing.createdBy, modifiedBy: MOCK_USER, modifiedOn: now }
            : { ...view, createdBy: MOCK_USER, createdOn: now };
          return of(this.upsert("views", stamped));
        }),
        forgetViews
      );
    }
    return this.post<LldApiStatus>(LLD_SAVE_VIEW_URL, request, token).pipe(
      map(result => ({ ...view, id: assertOk(result).ID || view.id })),
      forgetViews
    );
  }

  // One view's full details — what the View / Groups tabs and Edit / Delete
  // use. The LDID goes in the query string (…/GetLDViewDetails?LDID=7), the
  // body is empty. Remembered per view, so switching tabs makes no new call;
  // saving that view forgets it (see saveView()), and a failed fetch isn't
  // remembered.
  getViewDetails(id: number, token: string): Observable<LldView> {
    return this.cached(this.detailsCache, id, () =>
      USE_MOCK
        ? this.mockReady$.pipe(
            delay(MOCK_LATENCY_MS),
            mergeMap(() => {
              const view = this.store.views.find(v => v.id === id);
              return view ? of({ ...view }) : mockError(404, `View ${id} not found`);
            })
          )
        : this.post<LldApiResult<LldViewResponse>>(`${LLD_VIEW_DETAILS_URL}?LDID=${encodeURIComponent(id)}`, null, token).pipe(
            map((result: LldApiResult<LldViewResponse>) => toView(unwrapResult(result)))
          )
    );
  }
  private readonly detailsCache = new Map<number, Observable<LldView>>();

  // Soft delete: the same SaveLD call as an edit — the view's full model
  // (pass its details, see getViewDetails()) with only Status set to 3
  // (Deleted). The row (and its groups/sub-groups) stays in the database,
  // hidden from then on because getViews() skips it.
  deleteView(view: LldView, token: string): Observable<LldView> {
    return this.saveView({ ...view, status: LldViewStatus.Deleted }, token);
  }

  // ------------------------------------------------------------ groups
  // One view's groups in display order: GetLDGroupDetails with the LDID and
  // an empty GID in the query string (…/GetLDGroupDetails?LDID=7&GID=), the
  // body empty. The API doesn't return deleted groups.
  // TODO(host): the response has groups only — sub-groups get their own
  // API later; until then each group's come from the mock (none with the
  // real API).
  getGroups(viewId: number, token: string): Observable<LldGroupWithSubGroups[]> {
    const groups$: Observable<LldGroup[]> = USE_MOCK
      ? this.mock(() => this.store.groups.filter(g => g.viewId === viewId && !g.isDeleted))
      : this.post<LldApiResult<LldGroupRequest[] | LldGroupRequest | null>>(this.groupsUrl(viewId), null, token).pipe(
          map(result => groupRows(unwrapResult(result)).map(toGroup))
        );
    return groups$.pipe(
      map((groups: LldGroup[]) =>
        [...groups].sort(byGroupOrder).map(g => ({ ...g, subGroups: this.store.subGroups.filter(s => s.groupId === g.id) }))
      )
    );
  }

  // One group's details — GetLDGroupDetails with both the LDID and the GID.
  // What Edit opens the popup with.
  getGroup(viewId: number, groupId: number, token: string): Observable<LldGroup> {
    if (USE_MOCK) {
      return this.mockReady$.pipe(
        delay(MOCK_LATENCY_MS),
        mergeMap(() => {
          const group = this.store.groups.find(g => g.id === groupId && g.viewId === viewId && !g.isDeleted);
          return group ? of({ ...group }) : mockError(404, `Group ${groupId} not found`);
        })
      );
    }
    return this.post<LldApiResult<LldGroupRequest[] | LldGroupRequest | null>>(this.groupsUrl(viewId, groupId), null, token).pipe(
      map(result => {
        const row = groupRows(unwrapResult(result))[0];
        if (!row) {
          throw new Error(`Group ${groupId} not found`);
        }
        return toGroup(row);
      })
    );
  }

  private groupsUrl(viewId: number, groupId?: number): string {
    return `${LLD_GROUPS_URL}?LDID=${encodeURIComponent(viewId)}&GID=${groupId != null ? encodeURIComponent(groupId) : ""}`;
  }

  // Add / edit: SaveLDGroup with the full model — GroupID 0 for a new group,
  // its real id for an edit. Returns the saved group with the id the API
  // reports (ID). A rejected save (Status false, e.g. a duplicate name)
  // throws its message — the popup shows it.
  saveGroup(group: LldGroup, token: string): Observable<LldGroup> {
    const request = toGroupRequest(group);
    // TEMP: to check the SaveLDGroup payload while testing — remove afterwards.
    console.log(`[LLD] SaveLDGroup payload (${request.IsDeleted ? "delete" : request.GroupID ? "edit" : "add"})`, request);
    if (USE_MOCK) {
      return this.mockReady$.pipe(
        delay(MOCK_LATENCY_MS),
        mergeMap(() => {
          const name = group.name.trim().toLowerCase();
          const duplicate =
            !group.isDeleted &&
            this.store.groups.some(
              g => g.id !== group.id && g.viewId === group.viewId && !g.isDeleted && g.name.trim().toLowerCase() === name
            );
          return duplicate
            ? mockError(409, `This view already has a group named "${group.name}"`)
            : of(this.upsert("groups", group));
        })
      );
    }
    return this.post<LldApiStatus>(LLD_SAVE_GROUP_URL, request, token).pipe(
      map(result => ({ ...group, id: assertOk(result).ID || group.id }))
    );
  }

  // Soft delete: the same SaveLDGroup call as an edit — the group's full
  // model with IsDeleted true. GetLDGroupDetails stops returning it.
  deleteGroup(group: LldGroup, token: string): Observable<LldGroup> {
    return this.saveGroup({ ...group, isDeleted: true }, token);
  }

  // --------------------------------------------------------- sub-groups
  saveSubGroup(subGroup: LldSubGroup, token: string): Observable<LldSubGroup> {
    if (USE_MOCK) {
      return this.mockReady$.pipe(
        delay(MOCK_LATENCY_MS),
        mergeMap(() => {
          const error = this.validateSubGroup(subGroup);
          return error ? mockError(400, error) : of(this.upsert("subGroups", subGroup));
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

  // One shared fetch per key: later callers get the same answer without a
  // new call. A failed fetch isn't remembered, so the next call retries.
  private cached<K, T>(cache: Map<K, Observable<T>>, key: K, fetch: () => Observable<T>): Observable<T> {
    let result$ = cache.get(key);
    if (!result$) {
      result$ = fetch().pipe(
        catchError(err => {
          cache.delete(key);
          return throwError(() => err);
        }),
        shareReplay(1)
      );
      cache.set(key, result$);
    }
    return result$;
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
  private mockSubsurfaces!: LldApiResult<ElementResponse[]>;
  private mockStations: Record<number, ElementResponse[]> = {};
  private store: LldMockData = { views: [], groups: [], subGroups: [] };
  private readonly mockReady$: Observable<unknown> = USE_MOCK
    ? forkJoin([
        this.http.get<LldLookups>(MOCK_LOOKUPS_URL),
        this.http.get<LldMockData>(MOCK_DATA_URL),
        this.http.get<LldApiResult<ElementResponse[]>>(MOCK_SUBSURFACES_URL),
        this.http.get<Record<number, ElementResponse[]>>(MOCK_STATIONS_URL)
      ]).pipe(
        map(([lookups, data, subsurfaces, stations]) => {
          this.mockLookups = lookups;
          this.store = data;
          this.mockSubsurfaces = subsurfaces;
          this.mockStations = stations;
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
  // duplicate equipments — plus the name check only the server can do
  // (unique within the group).
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
    if (!s.equipments?.length) {
      return "Add at least one equipment";
    }
    if (new Set(s.equipments.map(e => e.equipmentId)).size !== s.equipments.length) {
      return "The same equipment is added more than once";
    }
    if (s.equipments.some(e => !e.name?.trim())) {
      return "Every equipment needs a name";
    }
    const name = s.name.trim().toLowerCase();
    if (this.store.subGroups.some(o => o.id !== s.id && o.groupId === s.groupId && o.name.trim().toLowerCase() === name)) {
      return `This group already has a sub-group named "${s.name}"`;
    }
    return null;
  }
}

// A rejected call, shaped like the real server's: an HTTP error whose body
// carries the message (see apiErrorMessage()).
function mockError(status: number, message: string): Observable<never> {
  return throwError(() => new HttpErrorResponse({ status, statusText: "Mock error", error: { message } }));
}
