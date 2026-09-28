// A dated note/observation a user logs against one of this collection's own
// circular charts (the "+" button in NxCircularChartCommentsComponent), NOT
// a real upstream payload from any host system — assets/mock-api/circular-
// chart-comments.json is this demo's own seed data, mocked the same
// lightweight way trend-response.json is (see NxCircularChartCommentsService's
// own comment). CamelCase throughout, deliberately breaking with this
// model file's own RawCircularChartNode/RawCircularChartCollectionNode
// convention (PascalCase, matching a real upstream payload's own field
// casing) — there is no real upstream here to mirror.
export interface CircularChartComment {
  // Assigned by NxCircularChartCommentsService.save() (a running counter
  // over whatever's already in the in-memory array) — never set by the
  // form itself.
  id: number;
  // ISO date string ("yyyy-MM-dd") — the sole source of this entry's
  // year; NxCircularChartCommentsService.getByYear() derives it via
  // `new Date(date).getFullYear()` rather than this interface also
  // carrying a separate `year` field, which could drift out of sync with
  // `date` the moment either is edited without the other.
  date: string;
  desc: string;
  // One of the collection's own chart names (NxCircularChartCollectionComponent
  // .specOptions, itself derived from circularCharts — already Hide-filtered/
  // ordered) — a free string here, not a typed union, since the actual set
  // of valid values is config-driven, not fixed at compile time.
  spec: string;
  // Filled automatically from the host's current user (the collection's
  // `currentUser` @Input) for a new comment; an edit keeps the original.
  reportedBy: string;
  customer: string;
  // The popup's Impact radio — true = Customer impact, false =
  // Non-Customer impact (the same split the charts' own slices use).
  isCustomer: boolean;
  // Optional period the comment covers — ISO "yyyy-MM-dd" strings, null when
  // not set. endDate is never before startDate (form validator).
  startDate: string | null;
  endDate: string | null;
}
