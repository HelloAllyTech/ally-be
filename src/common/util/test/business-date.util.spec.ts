import { BUSINESS_TIMEZONE, toBusinessDateString } from '../date.util';

// Deliberately does NOT mock dayjs — the whole point of these cases is the real
// timezone arithmetic at the IST day boundary. date.util.spec.ts mocks dayjs
// wholesale, so this lives in its own file.
describe('toBusinessDateString', () => {
  it('uses IST as the business timezone', () => {
    expect(BUSINESS_TIMEZONE).toBe('Asia/Kolkata');
  });

  it('returns a YYYY-MM-DD string', () => {
    expect(toBusinessDateString(new Date('2026-08-09T06:00:00.000Z'))).toBe(
      '2026-08-09',
    );
  });

  it.each([
    // IST is UTC+05:30, so 18:30 UTC is midnight IST — everything from there to
    // 23:59 UTC belongs to the NEXT IST day. This is the window where the old
    // UTC bucketing mis-filed late-night Indian practice and broke streaks.
    ['2026-08-08T18:29:59.000Z', '2026-08-08', '23:59 IST — still Aug 8'],
    ['2026-08-08T18:30:00.000Z', '2026-08-09', '00:00 IST — now Aug 9'],
    ['2026-08-08T20:00:00.000Z', '2026-08-09', '01:30 IST — Aug 9'],
    ['2026-08-08T22:30:00.000Z', '2026-08-09', '04:00 IST — Aug 9'],
    ['2026-08-08T23:59:00.000Z', '2026-08-09', '05:29 IST — Aug 9'],
    ['2026-08-09T00:00:00.000Z', '2026-08-09', '05:30 IST — Aug 9'],
  ])('maps %s to %s (%s)', (instant, expected) => {
    expect(toBusinessDateString(new Date(instant))).toBe(expected);
  });

  it('would disagree with naive UTC bucketing for a late-night IST session', () => {
    const lateNightIst = new Date('2026-08-08T22:30:00.000Z');

    const naiveUtcDay = lateNightIst.toISOString().split('T')[0];

    expect(naiveUtcDay).toBe('2026-08-08');
    expect(toBusinessDateString(lateNightIst)).toBe('2026-08-09');
  });

  it('keeps two sessions the user experienced on consecutive days consecutive', () => {
    // 02:00 IST Tuesday and 10:00 IST Wednesday. Under UTC bucketing these land
    // on Monday and Wednesday — a gap, so the streak resets to 1.
    const tuesday0200Ist = new Date('2026-08-10T20:30:00.000Z');
    const wednesday1000Ist = new Date('2026-08-12T04:30:00.000Z');

    expect(toBusinessDateString(tuesday0200Ist)).toBe('2026-08-11');
    expect(toBusinessDateString(wednesday1000Ist)).toBe('2026-08-12');
  });

  it('defaults to now when no instant is supplied', () => {
    expect(toBusinessDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
