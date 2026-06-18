import {
  getActiveSessionDurationSeconds,
  getSessionDurationInSeconds,
} from '../review.util';

describe('getActiveSessionDurationSeconds', () => {
  const start = new Date('2024-01-01T10:00:00Z');
  const end = new Date('2024-01-01T10:10:00Z'); // 600s wall

  it('equals wall-clock when there is no pause data', () => {
    expect(getActiveSessionDurationSeconds(start, end)).toBe(600);
    expect(getActiveSessionDurationSeconds(start, end, 0, null)).toBe(600);
    // matches the wall-clock helper exactly
    expect(getActiveSessionDurationSeconds(start, end)).toBe(
      getSessionDurationInSeconds(start, end),
    );
  });

  it('subtracts completed paused time (totalPausedMs)', () => {
    // 600s wall - 120s paused = 480s active
    expect(getActiveSessionDurationSeconds(start, end, 120_000)).toBe(480);
  });

  it('treats null totalPausedMs as zero', () => {
    expect(getActiveSessionDurationSeconds(start, end, null)).toBe(600);
  });

  it('closes an open pause interval when ended while paused', () => {
    // totalPausedMs=60s already banked; still paused since 10:08 → +120s to end
    const pausedAt = new Date('2024-01-01T10:08:00Z');
    // wall 600 - (60 + 120) = 420
    expect(getActiveSessionDurationSeconds(start, end, 60_000, pausedAt)).toBe(
      420,
    );
  });

  it('never goes negative when paused time exceeds wall-clock', () => {
    expect(getActiveSessionDurationSeconds(start, end, 999_000)).toBe(0);
  });

  it('returns 0 when dates are missing', () => {
    expect(getActiveSessionDurationSeconds(undefined as any, end, 1000)).toBe(
      0,
    );
  });
});
