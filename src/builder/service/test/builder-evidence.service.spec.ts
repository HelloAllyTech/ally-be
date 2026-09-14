import { BuilderEvidenceService } from '../builder-evidence.service';

/**
 * The interview's evidence lookups.
 *
 * Two properties matter more than the happy paths, and both are the kind that
 * fail silently:
 *
 *  1. Raw production log lines must never reach the model. The AWS logs
 *     controller is SUPER_DUPER_ADMIN-gated because those lines "can carry
 *     sensitive request data", and an interview transcript is durable,
 *     admin-facing and fed to an LLM. Shapes, not lines.
 *  2. A failed lookup must degrade the turn, not end it — and must say so in
 *     words, because a model told only "error" concludes the source is empty
 *     and asserts that to the admin.
 */
describe('BuilderEvidenceService', () => {
  const build = (over: Record<string, any> = {}) =>
    new BuilderEvidenceService(
      (over.analytics ?? { ask: jest.fn() }) as never,
      (over.logs ?? { getLogEvents: jest.fn() }) as never,
      (over.findings ?? { listOpenForRepo: jest.fn() }) as never,
    );

  describe('prodErrors', () => {
    const at = (iso: string) => new Date(iso).getTime();

    it('collapses repeated errors into one counted shape', async () => {
      const logs = {
        getLogEvents: jest.fn().mockResolvedValue({
          events: [
            {
              message: 'ERROR 2026-09-01T10:00:00Z user 4821 payment failed',
              timestamp: at('2026-09-01T10:00:00Z'),
            },
            {
              message: 'ERROR 2026-09-01T11:00:00Z user 9137 payment failed',
              timestamp: at('2026-09-01T11:00:00Z'),
            },
          ],
        }),
      };

      const result = await build({ logs }).prodErrors('ally-be');

      expect(result.ok).toBe(true);
      expect(result.shapes).toHaveLength(1);
      expect(result.shapes[0].count).toBe(2);
    });

    it('masks the identifiers that would otherwise leak', async () => {
      // The user id is exactly the kind of request data the gate on this
      // source exists to protect. Two lines differing only by it must produce
      // one shape, and that shape must not carry either value.
      const logs = {
        getLogEvents: jest.fn().mockResolvedValue({
          events: [
            {
              message: 'ERROR user 4821 token "abc-secret" expired',
              timestamp: 1,
            },
            {
              message: 'ERROR user 9137 token "xyz-secret" expired',
              timestamp: 2,
            },
          ],
        }),
      };

      const { shapes } = await build({ logs }).prodErrors('ally-be');

      expect(shapes).toHaveLength(1);
      expect(shapes[0].signature).not.toContain('4821');
      expect(shapes[0].signature).not.toContain('abc-secret');
    });

    it('says a frontend repo has no log group rather than failing', async () => {
      const result = await build().prodErrors('ally-web');

      expect(result.ok).toBe(true);
      expect(result.shapes).toEqual([]);
      expect(result.note).toContain('no server-side log group');
    });

    it('degrades with an explanation when the lookup throws', async () => {
      const logs = {
        getLogEvents: jest.fn().mockRejectedValue(new Error('cloudwatch down')),
      };

      const result = await build({ logs }).prodErrors('ally-be');

      expect(result.ok).toBe(false);
      // The wording is load-bearing: a model told only "error" will tell the
      // admin the logs are clean.
      expect(result.error).toContain('not an answer');
      expect(result.error).toContain('cloudwatch down');
    });
  });

  describe('analyticsAsk', () => {
    it('refuses an empty question without calling the agent', async () => {
      const analytics = { ask: jest.fn() };

      const result = await build({ analytics }).analyticsAsk('   ', 7);

      expect(result.ok).toBe(false);
      expect(analytics.ask).not.toHaveBeenCalled();
    });

    it('carries the SQL back so a figure in the PRD is traceable', async () => {
      const analytics = {
        ask: jest.fn().mockResolvedValue({
          outcome: 'answered',
          answer: '412 sessions',
          sql: 'SELECT count(*) FROM sessions',
          rows: [{ count: 412 }],
          caveats: [],
        }),
      };

      const result = await build({ analytics }).analyticsAsk('how many?', 7);

      expect(result.sql).toContain('SELECT');
      expect(result.rowCount).toBe(1);
    });

    it('degrades rather than throwing when the agent fails', async () => {
      const analytics = {
        ask: jest.fn().mockRejectedValue(new Error('ai down')),
      };

      const result = await build({ analytics }).analyticsAsk('how many?', 7);

      expect(result.ok).toBe(false);
      expect(result.error).toContain('not an answer');
    });
  });

  describe('openFindings', () => {
    it('returns a compact row per finding, not the whole entity', async () => {
      const findings = {
        listOpenForRepo: jest.fn().mockResolvedValue([
          {
            id: 'f1',
            repo: 'ally-be',
            status: 'new',
            title: 'Flaky auth spec',
            file: 'src/auth/a.spec.ts',
            description: 'a very long description that has no business here',
          },
        ]),
      };

      const result = await build({ findings }).openFindings('ally-be');

      expect(result.findings[0]).toEqual({
        id: 'f1',
        repo: 'ally-be',
        status: 'new',
        title: 'Flaky auth spec',
        file: 'src/auth/a.spec.ts',
      });
    });
  });
});
