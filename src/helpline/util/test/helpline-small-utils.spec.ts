import { isWithinHours } from '../helpline-hours';
import { TokenBucket } from '../helpline-token-bucket';
import { estimateWaitMinutes } from '../helpline-wait-estimate';
import { returningRows } from '../helpline-errors';

describe('estimateWaitMinutes', () => {
  it('is null with fewer than 5 samples', () => {
    expect(estimateWaitMinutes([60, 120, 180, 240])).toBeNull();
    expect(estimateWaitMinutes([])).toBeNull();
  });

  it('is the median in whole minutes, never below 1', () => {
    expect(estimateWaitMinutes([60, 120, 180, 240, 600])).toBe(3);
    expect(estimateWaitMinutes([5, 5, 5, 5, 5, 5])).toBe(1);
    expect(estimateWaitMinutes([60, 120, 180, 240, 300, 360])).toBe(4); // (180+240)/2 = 210 s
  });

  it('uses at most the 20 most recent samples', () => {
    const recent = Array(20).fill(60);
    const old = Array(30).fill(6000);
    expect(estimateWaitMinutes([...recent, ...old])).toBe(1);
  });
});

describe('isWithinHours', () => {
  const hours = {
    tz: 'Asia/Kolkata',
    weekly: [{ day: 1 as const, open: '09:00', close: '17:00' }],
  };

  it('null hours means always within hours', () => {
    expect(isWithinHours(null, new Date())).toBe(true);
  });

  it('checks the local weekday and time in the org zone', () => {
    // Monday 2026-10-05 10:00 IST = 04:30 UTC
    expect(isWithinHours(hours, new Date('2026-10-05T04:30:00Z'))).toBe(true);
    // Monday 18:00 IST
    expect(isWithinHours(hours, new Date('2026-10-05T12:30:00Z'))).toBe(false);
    // Sunday 10:00 IST
    expect(isWithinHours(hours, new Date('2026-10-04T04:30:00Z'))).toBe(false);
  });
});

describe('TokenBucket', () => {
  it('allows a burst of 5, then 1 per second', () => {
    const bucket = new TokenBucket(5, 1, 0);
    for (let i = 0; i < 5; i++) expect(bucket.take(0)).toBe(true);
    expect(bucket.take(0)).toBe(false);
    expect(bucket.take(999)).toBe(false);
    expect(bucket.take(1000)).toBe(true);
    expect(bucket.take(1000)).toBe(false);
  });
});

describe('returningRows', () => {
  it('reads the [rows, count] tuple TypeORM returns for UPDATE … RETURNING', () => {
    expect(returningRows([[{ id: 'a' }], 1])).toEqual([{ id: 'a' }]);
    expect(returningRows([[], 0])).toEqual([]);
  });

  it('passes a plain rows array through', () => {
    expect(returningRows([{ id: 'a' }, { id: 'b' }])).toEqual([
      { id: 'a' },
      { id: 'b' },
    ]);
  });
});
