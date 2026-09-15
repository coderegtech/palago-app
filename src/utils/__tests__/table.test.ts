import { applyTableControls } from '../table';

interface Row {
  name: string;
  code: string;
  capacity: number;
  status: string;
  retiredOn: string | null;
}

const rows: Row[] = [
  { name: 'Cherry 01', code: 'CB-01', capacity: 45, status: 'ACTIVE', retiredOn: null },
  { name: 'Cherry 02', code: 'CB-02', capacity: 9, status: 'INACTIVE', retiredOn: '2026-01-04' },
  { name: 'RoRo Alpha', code: 'RR-01', capacity: 30, status: 'ACTIVE', retiredOn: null },
  { name: 'roro beta', code: 'RR-02', capacity: 30, status: 'ACTIVE', retiredOn: '2026-03-09' },
];

describe('applyTableControls', () => {
  it('returns every row untouched with no controls', () => {
    const page = applyTableControls(rows);
    expect(page.rows).toHaveLength(4);
    expect(page.total).toBe(4);
    expect(page.pageCount).toBe(1);
  });

  it('searches case-insensitively across the named fields only', () => {
    const page = applyTableControls(rows, { query: 'roro', searchFields: ['name'] });
    expect(page.rows.map((r) => r.code)).toEqual(['RR-01', 'RR-02']);

    // The query matches a code, but codes were not offered to the search.
    expect(applyTableControls(rows, { query: 'RR-01', searchFields: ['name'] }).total).toBe(0);
    expect(applyTableControls(rows, { query: 'RR-01', searchFields: ['name', 'code'] }).total).toBe(1);
  });

  it('ignores an empty or whitespace-only query rather than matching nothing', () => {
    expect(applyTableControls(rows, { query: '   ', searchFields: ['name'] }).total).toBe(4);
  });

  it('applies exact-match filters and ignores blank ones', () => {
    expect(applyTableControls(rows, { filters: { status: 'ACTIVE' } }).total).toBe(3);
    expect(applyTableControls(rows, { filters: { status: null } }).total).toBe(4);
    expect(applyTableControls(rows, { filters: { status: '' } }).total).toBe(4);
  });

  it('sorts numbers numerically, not as strings', () => {
    const page = applyTableControls(rows, { sortKey: 'capacity' });
    // "9" sorts after "45" as a string; as a number it comes first.
    expect(page.rows.map((r) => r.capacity)).toEqual([9, 30, 30, 45]);
  });

  it('sorts text without regard to case', () => {
    const page = applyTableControls(rows, { sortKey: 'name' });
    expect(page.rows.map((r) => r.name)).toEqual([
      'Cherry 01',
      'Cherry 02',
      'RoRo Alpha',
      'roro beta',
    ]);
  });

  it('puts empty cells last in both directions', () => {
    const asc = applyTableControls(rows, { sortKey: 'retiredOn' });
    const desc = applyTableControls(rows, { sortKey: 'retiredOn', sortDirection: 'desc' });
    expect(asc.rows.at(-1)?.retiredOn).toBeNull();
    expect(desc.rows.at(-1)?.retiredOn).toBeNull();
  });

  it('does not mutate the array it was given', () => {
    const original = [...rows];
    applyTableControls(rows, { sortKey: 'capacity', sortDirection: 'desc' });
    expect(rows).toEqual(original);
  });

  it('paginates, and reports a page count that is right on an exact multiple', () => {
    const page1 = applyTableControls(rows, { page: 1, pageSize: 2 });
    expect(page1.rows).toHaveLength(2);
    expect(page1.pageCount).toBe(2);

    const page2 = applyTableControls(rows, { page: 2, pageSize: 2 });
    expect(page2.rows.map((r) => r.code)).toEqual(['RR-01', 'RR-02']);
  });

  it('clamps a page past the end back to the last page', () => {
    // Filtering down to one row while sitting on page 3 must show that row,
    // not an empty table that looks like "no results".
    const page = applyTableControls(rows, { page: 3, pageSize: 2, filters: { status: 'INACTIVE' } });
    expect(page.page).toBe(1);
    expect(page.rows).toHaveLength(1);
  });

  it('calls an empty table page 1 of 1', () => {
    const page = applyTableControls([] as Row[], { page: 1, pageSize: 10 });
    expect(page.pageCount).toBe(1);
    expect(page.total).toBe(0);
  });
});
