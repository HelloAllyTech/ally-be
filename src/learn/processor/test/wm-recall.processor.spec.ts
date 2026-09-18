import { WmRecallProcessor } from '../wm-recall.processor';

/**
 * This processor's job is to make a turn's recall decision durable exactly once.
 *
 * The queue is at-least-once and the write is a blind insert, so without a key on
 * (session, turn) a redelivery doubles a turn in every aggregate — the same defence turn
 * metrics needs for the same reason. And it must drop a sample rather than fail a message:
 * this queue also carries live sessions' working memory, so a retry-storm here would cost
 * something far more valuable than a row of telemetry.
 */
describe('WmRecallProcessor', () => {
  let sessions: { getScenarioSessionByRoomIdOrNull: jest.Mock };
  let insert: jest.Mock;
  let values: jest.Mock;
  let orUpdate: jest.Mock;
  let execute: jest.Mock;
  let processor: WmRecallProcessor;

  const message = (over: Record<string, unknown> = {}) => ({
    message_type: 'wm_recall',
    room_id: 'ss_room-1',
    data: {
      wm_recall: {
        turn_index: 7,
        stance: 'guarded',
        cue_tier: 'nominated',
        cue_count: 2,
        pool_size: 12,
        cap: 5,
        selected: [
          { text: 'she ran a tailoring shop', score: 1.9, cue_hits: 3 },
        ],
        passed_over: [
          { text: 'her son moved abroad', score: 1.7, cue_hits: 2 },
        ],
        ...over,
      },
    },
  });

  beforeEach(() => {
    execute = jest.fn().mockResolvedValue({});
    orUpdate = jest.fn(() => ({ execute }));
    values = jest.fn(() => ({ orUpdate }));
    insert = jest.fn(() => ({ values }));
    sessions = {
      getScenarioSessionByRoomIdOrNull: jest
        .fn()
        .mockResolvedValue({ id: 'sess-1', tenantId: 'tenant-1' }),
    };
    processor = new WmRecallProcessor(
      sessions as never,
      {
        getRepository: () => ({
          createQueryBuilder: () => ({ insert }),
        }),
      } as never,
    );
  });

  it('answers to its own message type', () => {
    expect(processor.getEventType()).toBe('wm_recall');
  });

  it('stores the decision against the session and turn', async () => {
    await processor.process(message() as never);
    const [row] = values.mock.calls[0];
    expect(row.scenarioSessionId).toBe('sess-1');
    expect(row.tenantId).toBe('tenant-1');
    expect(row.turnIndex).toBe(7);
    expect(row.cueTier).toBe('nominated');
    expect(row.poolSize).toBe(12);
  });

  it('keeps the passed-over candidates, which are the point', async () => {
    // A fact that scored just under the cap is the evidence that the cap or a weight is
    // wrong; the selection alone can never show it.
    await processor.process(message() as never);
    const [row] = values.mock.calls[0];
    expect(row.passedOver).toHaveLength(1);
    expect((row.passedOver as any[])[0].score).toBe(1.7);
  });

  it('upserts on (session, turn), so a redelivery cannot double a turn', async () => {
    await processor.process(message() as never);
    const [, conflictKey] = orUpdate.mock.calls[0];
    expect(conflictKey).toEqual(['scenarioSessionId', 'turnIndex']);
  });

  it('files an unrecognised cue tier as none rather than inventing a bucket', async () => {
    // The column is read as a distribution; a stray value would quietly become its own slice.
    await processor.process(message({ cue_tier: 'something_new' }) as never);
    expect(values.mock.calls[0][0].cueTier).toBe('none');
  });

  it('skips a preview room, which has no persisted session', async () => {
    await processor.process({
      ...message(),
      room_id: 'preview-abc',
    } as never);
    expect(insert).not.toHaveBeenCalled();
  });

  it('drops the sample when the session cannot be resolved', async () => {
    sessions.getScenarioSessionByRoomIdOrNull.mockResolvedValue(null);
    await processor.process(message() as never);
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects a payload with no turn index', async () => {
    await processor.process(message({ turn_index: undefined }) as never);
    expect(insert).not.toHaveBeenCalled();
  });

  it('accepts turn zero, which is a real turn', async () => {
    // `!event.turn_index` would have dropped the opening turn — the one where recall falls
    // back to the scenario description and is most likely to be wrong.
    await processor.process(message({ turn_index: 0 }) as never);
    expect(values.mock.calls[0][0].turnIndex).toBe(0);
  });

  it('never throws when the write fails', async () => {
    execute.mockRejectedValue(new Error('db down'));
    await expect(
      processor.process(message() as never),
    ).resolves.toBeUndefined();
  });
});
