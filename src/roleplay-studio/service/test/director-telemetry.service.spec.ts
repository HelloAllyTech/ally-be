import { DirectorTelemetryService } from '../director-telemetry.service';

/**
 * O18 — the director SQS queue is shared across environments, so an unresolved
 * room is usually another env's. But it can also be OUR room whose session row
 * is not yet visible when the first telemetry lands. resolveSessionWithRetry
 * recovers that race with a few short retries before giving up.
 */
describe('DirectorTelemetryService.resolveSessionWithRetry', () => {
  const makeService = (findOne: jest.Mock) => {
    const dataSource = { getRepository: () => ({ findOne }) } as any;
    return new DirectorTelemetryService({} as any, {} as any, dataSource);
  };

  beforeEach(() => {
    process.env.DIRECTOR_TELEMETRY_RESOLVE_ATTEMPTS = '3';
    process.env.DIRECTOR_TELEMETRY_RESOLVE_DELAY_MS = '1';
  });

  afterEach(() => {
    delete process.env.DIRECTOR_TELEMETRY_RESOLVE_ATTEMPTS;
    delete process.env.DIRECTOR_TELEMETRY_RESOLVE_DELAY_MS;
  });

  it('returns the session once it becomes visible on a later attempt', async () => {
    const session = { id: 'sess-1' };
    const findOne = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(session);
    const service = makeService(findOne);

    const result = await service.resolveSessionWithRetry('roleplay-abc');

    expect(result).toBe(session);
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting attempts (foreign room)', async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    const service = makeService(findOne);

    const result = await service.resolveSessionWithRetry('roleplay-foreign');

    expect(result).toBeNull();
    expect(findOne).toHaveBeenCalledTimes(3);
  });

  it('short-circuits an empty room id', async () => {
    const findOne = jest.fn();
    const service = makeService(findOne);

    expect(await service.resolveSessionWithRetry('')).toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });
});
