import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ChartPreferenceDto } from '../chart-preference.dto';

/**
 * `bucket` is stored as an opaque string, never interpolated into SQL — so it
 * validates against the full `AnalyticsGrain` vocabulary (including
 * `"allTime"`), not the narrower SQL-bucket-only `AnalyticsBucket`. Before this
 * widened, an "All-time" selection was silently dropped by this gate on save
 * and never survived a page reload.
 */
describe('ChartPreferenceDto', () => {
  const validateDto = (payload: Record<string, unknown>) =>
    validate(plainToInstance(ChartPreferenceDto, payload));

  it('accepts the minimal body', async () => {
    expect(await validateDto({ chartId: 'goals.xp' })).toHaveLength(0);
  });

  it('accepts every bucket value including allTime', async () => {
    for (const bucket of [
      'day',
      'week',
      'month',
      'quarter',
      'year',
      'allTime',
    ]) {
      expect(await validateDto({ chartId: 'goals.xp', bucket })).toHaveLength(
        0,
      );
    }
  });

  it('accepts every range value', async () => {
    for (const range of ['30d', '90d', '12m', 'all']) {
      expect(await validateDto({ chartId: 'goals.xp', range })).toHaveLength(0);
    }
  });

  it('accepts null range/bucket, the explicit-clear signal', async () => {
    const errors = await validateDto({
      chartId: 'goals.xp',
      range: null,
      bucket: null,
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects a bucket value outside the grain vocabulary', async () => {
    const errors = await validateDto({
      chartId: 'goals.xp',
      bucket: 'fortnight',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('bucket');
  });

  it('rejects a malformed chartId', async () => {
    const errors = await validateDto({ chartId: 'has a space' });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('chartId');
  });
});
