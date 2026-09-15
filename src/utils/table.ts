/**
 * Search, sort and pagination for the management tables.
 *
 * Pure, and separate from the toolbar that drives it, so the behaviour that is
 * easy to get quietly wrong — a search that misses a row, a page count that is
 * off by one on an exact multiple, a sort that reorders equal rows differently
 * each render — is unit-testable without rendering anything.
 *
 * These lists are reference data: operators, buses, routes, crew, a schedule
 * for a few weeks. Hundreds of rows, not millions, so filtering client-side
 * after one fetch is the right trade. `searchTrips` and the manifest stay
 * server-filtered because those are unbounded.
 */

export type SortDirection = 'asc' | 'desc';

export interface TableControls<T> {
  /** Free-text query, matched against `searchFields`. */
  query?: string;
  /** Which fields the query looks at. Omit to search nothing. */
  searchFields?: (keyof T)[];
  /** Exact-match filters. An entry with a null/undefined value is ignored. */
  filters?: Partial<Record<keyof T, string | null | undefined>>;
  sortKey?: keyof T;
  sortDirection?: SortDirection;
  /** 1-based. */
  page?: number;
  pageSize?: number;
}

export interface TablePage<T> {
  rows: T[];
  /** Rows matching the search and filters, before pagination. */
  total: number;
  page: number;
  pageCount: number;
}

function haystack(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).toLowerCase();
}

/**
 * Compares two cell values.
 *
 * Numbers and dates sort as themselves; everything else sorts as a
 * locale-aware, case-insensitive string, so "Él Nido" files next to "El Nido"
 * rather than after "Z".
 */
function compare(a: unknown, b: unknown, direction: SortDirection): number {
  // Empty cells sort last in BOTH directions. An empty cell is not "smallest",
  // it is missing, and a row with one is usually the row that needs attention —
  // burying it under the first page hides it. This is decided before the
  // direction is applied, because negating the whole comparison would flip
  // nulls to the top on a descending sort.
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  let result: number;
  if (typeof a === 'number' && typeof b === 'number') result = a - b;
  else if (typeof a === 'boolean' && typeof b === 'boolean') result = Number(a) - Number(b);
  else {
    result = String(a).localeCompare(String(b), undefined, {
      sensitivity: 'base',
      numeric: true,
    });
  }

  return direction === 'desc' ? -result : result;
}

export function applyTableControls<T>(rows: T[], controls: TableControls<T> = {}): TablePage<T> {
  const {
    query = '',
    searchFields = [],
    filters = {},
    sortKey,
    sortDirection = 'asc',
    page = 1,
    pageSize = 25,
  } = controls;

  const needle = query.trim().toLowerCase();

  let matched = rows;

  if (needle && searchFields.length > 0) {
    matched = matched.filter((row) =>
      searchFields.some((field) => haystack(row[field]).includes(needle)),
    );
  }

  for (const [field, wanted] of Object.entries(filters)) {
    if (wanted === null || wanted === undefined || wanted === '') continue;
    matched = matched.filter((row) => String((row as Record<string, unknown>)[field]) === wanted);
  }

  if (sortKey) {
    // Copied before sorting: `Array.prototype.sort` mutates, and these rows
    // come straight from a TanStack Query cache that other screens share.
    matched = [...matched].sort((a, b) => compare(a[sortKey], b[sortKey], sortDirection));
  }

  const total = matched.length;
  const size = Math.max(1, pageSize);
  // An empty table is page 1 of 1, not page 1 of 0.
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * size;

  return { rows: matched.slice(start, start + size), total, page: current, pageCount };
}
