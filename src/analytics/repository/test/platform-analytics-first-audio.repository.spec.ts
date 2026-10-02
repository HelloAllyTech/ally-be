import { DataSource } from 'typeorm';

import { PlatformAnalyticsRepository } from '../platform-analytics.repository';

/**
 * The first-audio split behind "What the learner heard first" (AAQ-085) and
 * its per-voice-model companion. Since ally-ai-learn v1.48.0 an opener's
 * bridge line is recorded as firstAudioSource='filler' with
 * `openerBridge: true`, so the filler count must EXCLUDE those turns or the
 * 100%-stacked bar double-counts them.
 */
describe('PlatformAnalyticsRepository first-audio split', () => {
  const build = (rawRows: Record<string, unknown>[] = []) => {
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue(undefined),
      getRawMany: jest.fn().mockResolvedValue(rawRows),
    };
    const dataSource = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as DataSource;
    const repository = new PlatformAnalyticsRepository(dataSource);
    return { repository, qb };
  };

  /** alias -> SQL expression, from every select/addSelect call. */
  const selectsByAlias = (qb: ReturnType<typeof build>['qb']) =>
    new Map(
      [...qb.select.mock.calls, ...qb.addSelect.mock.calls].map(
        ([sql, alias]) => [String(alias), String(sql)],
      ),
    );

  const start = new Date('2026-09-01T00:00:00.000Z');
  const end = new Date('2026-10-01T00:00:00.000Z');
  const BRIDGE = `m."metadata"->'openerBridge' = 'true'::jsonb`;

  describe('getVoiceLatencyByBucket', () => {
    it('counts opener bridges apart from fillers, and excludes them from the filler count', async () => {
      const { repository, qb } = build();

      await repository.getVoiceLatencyByBucket(start, end, 'week');

      const sel = selectsByAlias(qb);
      const bridge = sel.get('firstAudioOpenerBridgeTurns')!;
      expect(bridge).toContain(`m."metadata"->>'firstAudioSource' = 'filler'`);
      expect(bridge).toContain(BRIDGE);

      const filler = sel.get('firstAudioFillerTurns')!;
      expect(filler).toContain(`m."metadata"->>'firstAudioSource' = 'filler'`);
      expect(filler).toContain(`AND NOT COALESCE(${BRIDGE}, false)`);

      expect(sel.get('avgFirstAudioOpenerBridgeMs')).toContain(BRIDGE);
      expect(sel.get('avgFirstAudioFillerMs')).toContain(
        `NOT COALESCE(${BRIDGE}, false)`,
      );
    });

    it('splits a bridge line played alone from the legacy interim', async () => {
      const { repository, qb } = build();

      await repository.getVoiceLatencyByBucket(start, end, 'week');

      const sel = selectsByAlias(qb);
      const alone = sel.get('firstAudioBridgeTurns')!;
      expect(alone).toContain(`m."metadata"->>'firstAudioSource' = 'interim'`);
      expect(alone).toContain(`m."metadata"->>'interimSource' = 'bridge'`);

      // Legacy keeps unlabelled interim rows (pre-interimSource) rather than
      // guessing; IS DISTINCT FROM so a NULL label stays on this side.
      const legacy = sel.get('firstAudioInterimTurns')!;
      expect(legacy).toContain(`m."metadata"->>'firstAudioSource' = 'interim'`);
      expect(legacy).toContain(
        `m."metadata"->>'interimSource' IS DISTINCT FROM 'bridge'`,
      );
      expect(sel.get('avgFirstAudioBridgeMs')).toContain(
        `m."metadata"->>'interimSource' = 'bridge'`,
      );
    });

    it('maps the bridge count to a number and its mean to null when absent', async () => {
      const { repository } = build([
        {
          bucket: '2026-09-29',
          source: 'pipeline',
          turns: '10',
          avgMs: '1000',
          p50Ms: '900',
          p95Ms: '2000',
          avgLlmTtftMs: null,
          p50LlmTtftMs: null,
          p95LlmTtftMs: null,
          avgCacheHitRatePct: null,
          firstAudioFillerTurns: '4',
          firstAudioOpenerBridgeTurns: '3',
          firstAudioInterimTurns: '1',
          firstAudioBridgeTurns: '0',
          firstAudioReplyTurns: '2',
          firstAudioUnknownTurns: '0',
          avgFirstAudioFillerMs: '500',
          avgFirstAudioOpenerBridgeMs: '420',
          avgFirstAudioInterimMs: '800',
          avgFirstAudioBridgeMs: null,
          avgFirstAudioReplyMs: '3000',
          avgReplyLatencyMs: '3100',
          p50ReplyLatencyMs: '3000',
          p95ReplyLatencyMs: '5000',
        },
        {
          bucket: '2026-09-22',
          source: 'pipeline',
          turns: '2',
          avgMs: '1000',
          p50Ms: '900',
          p95Ms: '2000',
          avgLlmTtftMs: null,
          p50LlmTtftMs: null,
          p95LlmTtftMs: null,
          avgCacheHitRatePct: null,
          firstAudioFillerTurns: '2',
          firstAudioOpenerBridgeTurns: null,
          firstAudioInterimTurns: '0',
          firstAudioBridgeTurns: '0',
          firstAudioReplyTurns: '0',
          firstAudioUnknownTurns: '0',
          avgFirstAudioFillerMs: '500',
          avgFirstAudioOpenerBridgeMs: null,
          avgFirstAudioInterimMs: null,
          avgFirstAudioBridgeMs: null,
          avgFirstAudioReplyMs: null,
          avgReplyLatencyMs: null,
          p50ReplyLatencyMs: null,
          p95ReplyLatencyMs: null,
        },
      ]);

      const [withBridge, preBridge] = await repository.getVoiceLatencyByBucket(
        start,
        end,
        'week',
      );

      expect(withBridge).toMatchObject({
        firstAudioFillerTurns: 4,
        firstAudioOpenerBridgeTurns: 3,
        avgFirstAudioOpenerBridgeMs: 420,
      });
      expect(preBridge).toMatchObject({
        firstAudioOpenerBridgeTurns: 0,
        avgFirstAudioOpenerBridgeMs: null,
      });
    });
  });

  describe('getVoiceLatencyByVoiceModel', () => {
    it("groups by metadata.ttsModel with an 'unknown' bucket, never dropping unrecorded rows", async () => {
      const { repository, qb } = build();

      await repository.getVoiceLatencyByVoiceModel(start, end);

      const ttsModelSql = `COALESCE(NULLIF(m."metadata"->>'ttsModel', ''), 'unknown')`;
      expect(qb.select).toHaveBeenCalledWith(ttsModelSql, 'ttsModel');
      expect(qb.groupBy).toHaveBeenCalledWith(ttsModelSql);
      // No WHERE clause on ttsModel — a missing one buckets, it doesn't filter.
      expect(
        qb.andWhere.mock.calls.some(([sql]) =>
          String(sql).includes('ttsModel'),
        ),
      ).toBe(false);
    });

    it('splits filler / opener bridge / interim / reply / unknown with the same rules as the trend', async () => {
      const { repository, qb } = build();

      await repository.getVoiceLatencyByVoiceModel(start, end);

      const sel = selectsByAlias(qb);
      expect(sel.get('openerBridgeTurns')).toContain(BRIDGE);
      expect(sel.get('fillerTurns')).toContain(
        `NOT COALESCE(${BRIDGE}, false)`,
      );
      expect(sel.get('interimTurns')).toContain(
        `m."metadata"->>'firstAudioSource' = 'interim'`,
      );
      expect(sel.get('replyTurns')).toContain(
        `m."metadata"->>'firstAudioSource' = 'reply'`,
      );
      expect(sel.get('unknownTurns')).toContain(
        `m."metadata"->>'firstAudioSource' IS NULL`,
      );
      expect(sel.get('p50FirstAudioMs')).toContain(
        'percentile_cont(0.5) WITHIN GROUP (ORDER BY m."responseLatencyMs")',
      );
      // Same replyLatency expression and instrumented-only filter as the trend.
      const p50Reply = sel.get('p50ReplyLatencyMs')!;
      expect(p50Reply).toContain(`m."metadata"->'replyLatencyMs'`);
      expect(p50Reply).toContain(
        `FILTER (WHERE m."metadata"->>'firstAudioSource' IS NOT NULL)`,
      );
    });

    it('scopes to the live pipeline and only joins languages when filtered', async () => {
      const { repository: unfiltered, qb: unfilteredQb } = build();
      await unfiltered.getVoiceLatencyByVoiceModel(start, end);
      expect(unfilteredQb.andWhere).toHaveBeenCalledWith(
        `m."source" = 'pipeline'`,
      );
      expect(unfilteredQb.innerJoin).not.toHaveBeenCalled();

      const { repository: filtered, qb: filteredQb } = build();
      await filtered.getVoiceLatencyByVoiceModel(start, end, 'kn-IN');
      expect(filteredQb.innerJoin).toHaveBeenCalledWith(
        'scenario_sessions',
        's',
        's.id = m."scenarioSessionId"',
      );
      expect(filteredQb.andWhere).toHaveBeenCalledWith(
        `COALESCE(l.value, 'en') = :language`,
        { language: 'kn-IN' },
      );
    });

    it('coerces counts to numbers and keeps unpopulated latencies null', async () => {
      const { repository } = build([
        {
          ttsModel: 'elevenlabs/eleven_v3',
          turns: '40',
          fillerTurns: '0',
          openerBridgeTurns: '0',
          interimTurns: '0',
          bridgeTurns: '0',
          replyTurns: '40',
          unknownTurns: '0',
          p50FirstAudioMs: '3400',
          p50ReplyLatencyMs: '3400',
        },
        {
          ttsModel: 'unknown',
          turns: '15',
          fillerTurns: '0',
          openerBridgeTurns: '0',
          interimTurns: '0',
          bridgeTurns: '0',
          replyTurns: '0',
          unknownTurns: '15',
          p50FirstAudioMs: '2000',
          p50ReplyLatencyMs: null,
        },
      ]);

      const rows = await repository.getVoiceLatencyByVoiceModel(start, end);

      expect(rows).toEqual([
        {
          ttsModel: 'elevenlabs/eleven_v3',
          turns: 40,
          fillerTurns: 0,
          openerBridgeTurns: 0,
          interimTurns: 0,
          bridgeTurns: 0,
          replyTurns: 40,
          unknownTurns: 0,
          p50FirstAudioMs: 3400,
          p50ReplyLatencyMs: 3400,
        },
        {
          ttsModel: 'unknown',
          turns: 15,
          fillerTurns: 0,
          openerBridgeTurns: 0,
          interimTurns: 0,
          bridgeTurns: 0,
          replyTurns: 0,
          unknownTurns: 15,
          p50FirstAudioMs: 2000,
          p50ReplyLatencyMs: null,
        },
      ]);
    });
  });
});
