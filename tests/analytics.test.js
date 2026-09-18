/**
 * @jest-environment node
 *
 * tests/analytics.test.js
 * The privacy policy promises analytics are deleted after 12 months; these
 * tests pin that the clean-up covers every analytics table.
 */
jest.mock('../db/pool', () => ({ query: jest.fn() }));

const pool      = require('../db/pool');
const analytics = require('../db/analytics');

beforeEach(() => {
  pool.query.mockReset();
  pool.query.mockResolvedValue({ rowCount: 2 });
});

describe('analytics.pruneExpired()', () => {
  it('deletes page views, events and visitors older than 12 months by default', async () => {
    const result = await analytics.pruneExpired();

    const statements = pool.query.mock.calls.map(([sql]) => sql);
    expect(statements.some((s) => /DELETE FROM page_views/.test(s))).toBe(true);
    expect(statements.some((s) => /DELETE FROM events/.test(s))).toBe(true);
    expect(statements.some((s) => /DELETE FROM visitors/.test(s))).toBe(true);
    for (const [, params] of pool.query.mock.calls) {
      expect(params).toEqual(['12 months']);
    }
    expect(result).toEqual({ pageViews: 2, events: 2, visitors: 2 });
  });

  it('passes the retention period as a bound parameter, never interpolated SQL', async () => {
    for (const hostile of ["1'; DROP TABLE events; --", 'DROP TABLE events', -5]) {
      pool.query.mockClear();
      await analytics.pruneExpired(hostile);
      for (const [sql, params] of pool.query.mock.calls) {
        expect(sql).not.toContain('DROP');
        // Only "<positive integer> months" can ever reach the database
        expect(params[0]).toMatch(/^[1-9]\d* months$/);
      }
    }
  });

  it('falls back to 12 months for non-numeric input', async () => {
    await analytics.pruneExpired('not a number');
    for (const [, params] of pool.query.mock.calls) {
      expect(params).toEqual(['12 months']);
    }
  });

  it('exposes the 12-month period promised in the privacy policy', () => {
    expect(analytics.RETENTION_MONTHS).toBe(12);
  });
});
