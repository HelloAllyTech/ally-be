import {
  currentPeriodKey,
  isValidPeriodKey,
} from '../../util/roadmap-period.util';

/**
 * The vote budget's month boundary.
 *
 * The standalone app derived this in the browser from local getMonth(), which meant a tab left
 * open across midnight on the 1st wrote votes into the PREVIOUS month, and a user in IST
 * disagreed with a UTC server about which month they were voting in. One authority (UTC,
 * server-side) removes both bugs, and the clock is injected so these tests are deterministic
 * rather than "run it in December".
 */
describe('currentPeriodKey', () => {
  it('formats YYYY-MM zero-padded', () => {
    expect(currentPeriodKey(new Date('2026-07-15T12:00:00Z'))).toBe('2026-07');
    // The bug this guards: '2026-7' would fail the DB CHECK constraint outright.
    expect(currentPeriodKey(new Date('2026-01-15T12:00:00Z'))).toBe('2026-01');
    expect(currentPeriodKey(new Date('2026-12-15T12:00:00Z'))).toBe('2026-12');
  });

  it('rolls over at the UTC year boundary, not the local one', () => {
    expect(currentPeriodKey(new Date('2026-12-31T23:30:00Z'))).toBe('2026-12');
    expect(currentPeriodKey(new Date('2027-01-01T00:30:00Z'))).toBe('2027-01');
  });

  it('rolls over at the UTC month boundary', () => {
    expect(currentPeriodKey(new Date('2026-07-31T23:59:59Z'))).toBe('2026-07');
    expect(currentPeriodKey(new Date('2026-08-01T00:00:00Z'))).toBe('2026-08');
  });

  it('is UTC-based, so a late-evening IST instant on the 1st still reads as the new month', () => {
    // 2026-08-01T04:30:00+05:30 is 2026-07-31T23:00:00Z — still July in UTC. The point is not
    // which answer is "right" but that the server is the single authority, so client and server
    // can never disagree.
    expect(currentPeriodKey(new Date('2026-07-31T23:00:00Z'))).toBe('2026-07');
  });
});

describe('isValidPeriodKey', () => {
  it('accepts every real month', () => {
    for (let month = 1; month <= 12; month++) {
      expect(isValidPeriodKey(`2026-${String(month).padStart(2, '0')}`)).toBe(
        true,
      );
    }
  });

  it('rejects malformed keys, matching CHK_roadmap_allocations_period', () => {
    for (const bad of [
      '2026-13',
      '2026-00',
      '2026-0',
      '26-01',
      '2026-1',
      '2026/01',
      '',
      'x',
    ]) {
      expect(isValidPeriodKey(bad)).toBe(false);
    }
  });
});
