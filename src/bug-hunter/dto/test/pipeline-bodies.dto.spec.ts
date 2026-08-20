import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

import {
  BUG_HUNT_RUN_CLOSE_STATUSES,
  CloseBugHuntRunDto,
  PatchBugFindingDto,
  PersistBugFindingsDto,
  RecordBugHuntRunCostDto,
  StartBugHuntRunDto,
} from '../bug-hunter.dto';
import {
  BugFindingSeverity,
  BugFindingSource,
  BugFindingStatus,
} from '../../enum/bug-finding.enum';
import { BugHuntTrigger } from '../../enum/bug-hunt-run.enum';

/**
 * The five machine-surface bodies that used to be inline object types, i.e.
 * erased at runtime and therefore never validated at all.
 *
 * Each block asserts BOTH directions on purpose. Rejecting bad values is the
 * point, but these endpoints are driven by an LLM following a prompt, so
 * accidentally tightening past what the schema allows would break the nightly
 * sweep — and that failure would look exactly like the bug this replaced.
 */
describe('the pipeline controller bodies', () => {
  /** Nested errors hang off the parent, so flatten before asking about a field. */
  const fields = (errors: ValidationError[]): string[] =>
    errors.flatMap((e) => [e.property, ...fields(e.children ?? [])]);

  const check = async (cls: any, payload: Record<string, unknown>) =>
    fields(await validate(plainToInstance(cls, payload)));

  describe('StartBugHuntRunDto', () => {
    it('accepts every trigger the enum defines', async () => {
      for (const trigger of Object.values(BugHuntTrigger)) {
        expect(
          await check(StartBugHuntRunDto, { trigger, repo: 'ally-be' }),
        ).toEqual([]);
      }
    });

    it('rejects a trigger the CHECK constraint would have refused anyway', async () => {
      expect(
        await check(StartBugHuntRunDto, {
          trigger: 'nightly',
          repo: 'ally-be',
        }),
      ).toContain('trigger');
    });

    it('requires a non-empty repo', async () => {
      expect(
        await check(StartBugHuntRunDto, { trigger: BugHuntTrigger.SCHEDULED }),
      ).toContain('repo');
      expect(
        await check(StartBugHuntRunDto, {
          trigger: BugHuntTrigger.SCHEDULED,
          repo: '',
        }),
      ).toContain('repo');
    });
  });

  describe('PersistBugFindingsDto', () => {
    const batch = (...findings: Record<string, unknown>[]) => ({
      repo: 'ally-be',
      findings,
    });
    const finding = {
      source: BugFindingSource.CODE_REVIEW,
      description: 'The retry loop never resets its counter.',
    };

    it('accepts a finding carrying only what the schema demands', async () => {
      expect(await check(PersistBugFindingsDto, batch(finding))).toEqual([]);
    });

    it('accepts a finding with no file — the production-log case', async () => {
      // The column is nullable and dedupeKey takes null. Requiring `file`
      // here would reject the prod-log finder outright.
      expect(
        await check(
          PersistBugFindingsDto,
          batch({ ...finding, file: undefined }),
        ),
      ).toEqual([]);
    });

    it('accepts every source and severity the enums define', async () => {
      for (const source of Object.values(BugFindingSource)) {
        expect(
          await check(PersistBugFindingsDto, batch({ ...finding, source })),
        ).toEqual([]);
      }
      for (const severity of Object.values(BugFindingSeverity)) {
        expect(
          await check(PersistBugFindingsDto, batch({ ...finding, severity })),
        ).toEqual([]);
      }
    });

    it('accepts a fully-populated finding', async () => {
      expect(
        await check(
          PersistBugFindingsDto,
          batch({
            ...finding,
            file: 'src/retry.ts',
            symbol: 'withRetry',
            evidence: 'attempts=4 after a success',
            severity: BugFindingSeverity.HIGH,
            proven: true,
            touchesGuardedPath: false,
            reportedBugId: '11111111-1111-4111-8111-111111111111',
          }),
        ),
      ).toEqual([]);
    });

    it('rejects an unrecognised source or severity', async () => {
      expect(
        await check(
          PersistBugFindingsDto,
          batch({ ...finding, source: 'vibes' }),
        ),
      ).toContain('source');
      expect(
        await check(
          PersistBugFindingsDto,
          batch({ ...finding, severity: 'critical' }),
        ),
      ).toContain('severity');
    });

    it('rejects a finding with no description — it is sliced for the title', async () => {
      expect(
        await check(PersistBugFindingsDto, batch({ source: finding.source })),
      ).toContain('description');
    });

    it('rejects the whole batch when any one finding is bad', async () => {
      // All-or-nothing is the improvement: persistFindings saves in a loop, so
      // a bad third finding used to leave the first two written and return no
      // ids for either.
      const errors = await check(
        PersistBugFindingsDto,
        batch(finding, finding, { ...finding, source: 'vibes' }),
      );
      expect(errors).toContain('source');
    });

    it('rejects a non-array findings, and a missing repo', async () => {
      expect(
        await check(PersistBugFindingsDto, {
          repo: 'ally-be',
          findings: finding,
        }),
      ).toContain('findings');
      expect(await check(PersistBugFindingsDto, { findings: [] })).toContain(
        'repo',
      );
    });
  });

  describe('PatchBugFindingDto', () => {
    it('accepts every status the enum defines', async () => {
      for (const status of Object.values(BugFindingStatus)) {
        expect(await check(PatchBugFindingDto, { status })).toEqual([]);
      }
    });

    it('accepts a patch that only sets a PR url, or nothing at all', async () => {
      expect(
        await check(PatchBugFindingDto, {
          prUrl: 'https://github.com/x/y/pull/1',
        }),
      ).toEqual([]);
      expect(await check(PatchBugFindingDto, {})).toEqual([]);
    });

    it('rejects a status the CHECK constraint would have refused', async () => {
      expect(await check(PatchBugFindingDto, { status: 'done' })).toContain(
        'status',
      );
    });
  });

  describe('RecordBugHuntRunCostDto', () => {
    const usage = {
      model: 'claude-opus-4-5',
      inputTokens: 10,
      outputTokens: 2,
    };

    it('accepts real usage, with and without the CLI figure', async () => {
      expect(
        await check(RecordBugHuntRunCostDto, { modelUsage: [usage] }),
      ).toEqual([]);
      expect(
        await check(RecordBugHuntRunCostDto, {
          modelUsage: [usage],
          cliReportedCostUsd: 0.41,
        }),
      ).toEqual([]);
    });

    it('rejects a stringy or negative token count', async () => {
      // recordActualCost swallows its own failures, so before this the run's
      // cost data vanished behind a single log line.
      expect(
        await check(RecordBugHuntRunCostDto, {
          modelUsage: [{ ...usage, inputTokens: '10' }],
        }),
      ).toContain('inputTokens');
      expect(
        await check(RecordBugHuntRunCostDto, {
          modelUsage: [{ ...usage, outputTokens: -1 }],
        }),
      ).toContain('outputTokens');
    });

    it('rejects usage with no model named', async () => {
      expect(
        await check(RecordBugHuntRunCostDto, {
          modelUsage: [{ inputTokens: 1, outputTokens: 1 }],
        }),
      ).toContain('model');
    });
  });

  describe('CloseBugHuntRunDto', () => {
    const totals = {
      foundCount: 3,
      autoMergedCount: 1,
      prOpenedCount: 1,
      dismissedCount: 1,
    };

    it('accepts exactly the two closing states', async () => {
      expect(BUG_HUNT_RUN_CLOSE_STATUSES).toEqual(['completed', 'failed']);
      for (const status of BUG_HUNT_RUN_CLOSE_STATUSES) {
        expect(await check(CloseBugHuntRunDto, { status, ...totals })).toEqual(
          [],
        );
      }
    });

    it.each([['complete'], ['error'], ['COMPLETED'], ['skipped_disabled']])(
      'rejects %p rather than silently filing it as completed',
      async (status) => {
        // The handler maps anything that is not 'failed' to COMPLETED, so this
        // is the guard that stops a dead sweep reading as a clean night.
        expect(
          await check(CloseBugHuntRunDto, { status, ...totals }),
        ).toContain('status');
      },
    );

    it('requires a status at all, for the same reason', async () => {
      expect(await check(CloseBugHuntRunDto, totals)).toContain('status');
    });

    it('lets the totals be omitted — a close that 400s strands the run open', async () => {
      expect(await check(CloseBugHuntRunDto, { status: 'completed' })).toEqual(
        [],
      );
    });

    it('still type-checks the totals it is given', async () => {
      expect(
        await check(CloseBugHuntRunDto, {
          status: 'completed',
          foundCount: '3',
        }),
      ).toContain('foundCount');
      expect(
        await check(CloseBugHuntRunDto, {
          status: 'completed',
          dismissedCount: -1,
        }),
      ).toContain('dismissedCount');
    });

    it('carries an error message on a failed close', async () => {
      expect(
        await check(CloseBugHuntRunDto, {
          status: 'failed',
          errorMessage: 'lint never went green',
        }),
      ).toEqual([]);
    });
  });
});
