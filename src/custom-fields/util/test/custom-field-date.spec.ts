import { orgCalendarDateSql, toOrgCalendarDate } from '../custom-field-date';

describe('toOrgCalendarDate', () => {
  it('passes a bare calendar date through untouched', () => {
    expect(toOrgCalendarDate('2026-08-22')).toBe('2026-08-22');
  });

  it('resolves a legacy IST-midnight instant to the day that was picked', () => {
    // 22 Aug picked in IST was stored as 18:30 on the 21st in UTC. Reading it
    // in UTC is what showed the 21st on mobile and in the SQL date cast.
    expect(toOrgCalendarDate('2026-08-21T18:30:00.000Z')).toBe('2026-08-22');
  });

  it('keeps an instant already inside the org day on that day', () => {
    expect(toOrgCalendarDate('2026-08-22T06:00:00.000Z')).toBe('2026-08-22');
  });

  it('returns null for absent or unparseable input', () => {
    expect(toOrgCalendarDate(null)).toBeNull();
    expect(toOrgCalendarDate('')).toBeNull();
    expect(toOrgCalendarDate('   ')).toBeNull();
    expect(toOrgCalendarDate('not-a-date')).toBeNull();
  });
});

describe('orgCalendarDateSql', () => {
  it('handles both storage shapes and nulls anything else', () => {
    const sql = orgCalendarDateSql('cfv.value');
    expect(sql).toContain('cfv.value::date');
    expect(sql).toContain("AT TIME ZONE 'Asia/Kolkata'");
    expect(sql).toContain('ELSE NULL');
  });
});
