import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BugFindingRepository } from 'src/bug-hunter/repository/bug-finding.repository';
import {
  BugFindingSeverity,
  BugFindingSource,
  BugFindingStatus,
} from 'src/bug-hunter/enum/bug-finding.enum';
import { AnalyticsSuggestion } from 'src/analytics-suggestions/entity/analytics-suggestion.entity';
import {
  AnalyticsSuggestionSource,
  AnalyticsSuggestionStatus,
} from 'src/analytics-suggestions/enum/analytics-suggestion.enum';

import { UxSignalWriterService } from '../ux-signal-writer.service';
import { UxSignalKind } from '../../enum/ux-signal.enum';
import { TriagedItem } from '../../ux-signals.types';

/**
 * The writer is the pipeline's only mutation point, and its dedupe behaviour is
 * what decides whether a daily scan is useful or is a machine for generating the
 * same ticket forever.
 */
describe('UxSignalWriterService', () => {
  let service: UxSignalWriterService;
  let findOpenByDedupeKey: jest.Mock;
  let saveFinding: jest.Mock;
  let saveSuggestion: jest.Mock;
  let suggestionQueryBuilder: { getOne: jest.Mock };
  /** Every statement any transactional manager ran, in order. */
  let txStatements: string[];

  const scan = {
    windowFrom: '2026-08-20',
    windowTo: '2026-08-27',
    model: 'claude-test',
  };

  const bug = (over: Partial<TriagedItem> = {}): TriagedItem => ({
    kind: UxSignalKind.BUG,
    title: 'Retry button on /inbox does nothing',
    body: 'Rage clicks cluster on the Retry control while sending fails.',
    severity: BugFindingSeverity.HIGH,
    rationale: 'Blocks a send while a caller waits.',
    evidence: ['9 rage clicks across 5 sessions'],
    route: '/inbox',
    target: 'element "Retry"',
    suggestedGoal: null,
    confidence: 'high — errors corroborate the clicks',
    ...over,
  });

  const improvement = (over: Partial<TriagedItem> = {}): TriagedItem => ({
    ...bug(),
    kind: UxSignalKind.IMPROVEMENT,
    title: 'Resources page loses most visitors',
    suggestedGoal: 'Improve learner engagement',
    ...over,
  });

  beforeEach(async () => {
    findOpenByDedupeKey = jest.fn().mockResolvedValue(null);
    saveFinding = jest.fn(async (row) => row);
    saveSuggestion = jest.fn(async (row) => row);
    txStatements = [];

    // Stands in for the pending ux_signal rows the duplicate check reads. The
    // answer is fixed when the query is issued and delivered a tick later, which
    // is what lets two overlapping passes both see "nothing pending" unless
    // something serialises them.
    const stored: unknown[] = [];
    suggestionQueryBuilder = {
      getOne: jest.fn(async () => {
        const asOfQueryTime = stored[0] ?? null;
        await new Promise((resolve) => setImmediate(resolve));
        return asOfQueryTime;
      }),
    };
    const record = async (row: unknown) => {
      stored.push(row);
      return saveSuggestion(row);
    };

    const chainable = {
      where: () => chainable,
      andWhere: () => chainable,
      getOne: () => suggestionQueryBuilder.getOne(),
    };
    const transactionalRepository = {
      createQueryBuilder: () => chainable,
      create: (row: unknown) => row,
      save: record,
    };

    // A stand-in for Postgres transaction-level advisory locks: a transaction
    // that asks for the lock waits for whoever holds it and keeps it until it
    // commits, and one that never asks is not serialised at all. Modelling the
    // second half matters — a plain transaction under READ COMMITTED would not
    // make a check-then-insert atomic, so the test must not pretend it does.
    let lockChain: Promise<void> = Promise.resolve();
    const manager = {
      transaction: async <T>(
        run: (entityManager: unknown) => Promise<T>,
      ): Promise<T> => {
        let releaseLock: () => void = () => {};
        const entityManager = {
          query: async (sql: string) => {
            txStatements.push(sql);
            if (!sql.includes('pg_advisory_xact_lock')) return [];
            const heldByOthers = lockChain;
            lockChain = new Promise<void>((resolve) => {
              releaseLock = resolve;
            });
            await heldByOthers;
            return [{}];
          },
          getRepository: () => transactionalRepository,
        };
        try {
          return await run(entityManager);
        } finally {
          releaseLock();
        }
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UxSignalWriterService,
        {
          provide: BugFindingRepository,
          useValue: {
            findOpenByDedupeKey,
            create: (row: unknown) => row,
            save: saveFinding,
          },
        },
        {
          provide: getRepositoryToken(AnalyticsSuggestion),
          useValue: {
            createQueryBuilder: () => chainable,
            create: (row: unknown) => row,
            save: record,
            manager,
          },
        },
      ],
    }).compile();

    service = module.get(UxSignalWriterService);
  });

  afterEach(() => jest.clearAllMocks());

  it('files a bug as a NEW ux_signal finding with the route as its symbol', async () => {
    // symbol is the whole reason UX findings dedupe precisely: they carry no
    // file, so without it the key falls back to a fingerprint of LLM prose.
    const result = await service.write([bug()], scan, 7);

    expect(result.findingsCreated).toBe(1);
    const saved = saveFinding.mock.calls[0][0];
    expect(saved.source).toBe(BugFindingSource.UX_SIGNAL);
    expect(saved.status).toBe(BugFindingStatus.NEW);
    expect(saved.symbol).toBe('/inbox|element "Retry"');
    expect(saved.dedupeKey).toEqual(expect.any(String));
    // repo has to be set outright or the drawer's fix-session button cannot work.
    expect(saved.repo).toBe('ally-web');
    // Never claim a verification that did not happen.
    expect(saved.proven).toBe(false);
  });

  it('counts an already-open bug as a skipped duplicate instead of re-filing', async () => {
    findOpenByDedupeKey.mockResolvedValue({ id: 'existing' });

    const result = await service.write([bug()], scan, 7);

    expect(result.findingsCreated).toBe(0);
    expect(result.skippedDuplicates).toBe(1);
    expect(saveFinding).not.toHaveBeenCalled();
  });

  it('derives the same dedupe key from a reworded description of one bug', async () => {
    // The model rewords freely between runs. Two descriptions of the same
    // route+control must collapse, or the queue grows a row a night.
    await service.write([bug()], scan, 7);
    const firstKey = saveFinding.mock.calls[0][0].dedupeKey;

    saveFinding.mockClear();
    await service.write(
      [
        bug({
          title: 'Send retry unresponsive on inbox',
          body: 'Users repeatedly click Retry; the send never completes.',
        }),
      ],
      scan,
      7,
    );

    expect(saveFinding.mock.calls[0][0].dedupeKey).toBe(firstKey);
  });

  it('files an improvement as a pending ux_signal suggestion', async () => {
    const result = await service.write([improvement()], scan, 7);

    expect(result.suggestionsCreated).toBe(1);
    const saved = saveSuggestion.mock.calls[0][0];
    expect(saved.source).toBe(AnalyticsSuggestionSource.UX_SIGNAL);
    expect(saved.status).toBe(AnalyticsSuggestionStatus.PENDING);
    expect(saved.suggestedGoal).toBe('Improve learner engagement');
    expect(saved.model).toBe('claude-test');
    expect(saved.createdBy).toBe(7);
  });

  it('attributes a scheduled scan to the system user', async () => {
    // A scheduled run has no acting admin; 0 is ally-be's convention for these
    // audit columns, and a null would violate NOT NULL.
    await service.write([improvement()], scan, null);

    const saved = saveSuggestion.mock.calls[0][0];
    expect(saved.createdBy).toBe(0);
    expect(saved.updatedBy).toBe(0);
  });

  it('skips a suggestion whose title is already awaiting a decision', async () => {
    suggestionQueryBuilder.getOne.mockResolvedValue({ id: 'pending-one' });

    const result = await service.write([improvement()], scan, 7);

    expect(result.suggestionsCreated).toBe(0);
    expect(result.skippedDuplicates).toBe(1);
    expect(saveSuggestion).not.toHaveBeenCalled();
  });

  it('files one suggestion, not two, when two passes file the same title at once', async () => {
    // Two write passes can overlap when a scan outlives the staleness cutoff and
    // a second one starts alongside it. Both read the pending queue before
    // either has committed, so the title check on its own cannot separate them —
    // and a second near-identical card is exactly the clutter this queue is
    // supposed to stay free of.
    const item = improvement();

    const [first, second] = await Promise.all([
      service.write([item], scan, 7),
      service.write([item], scan, 7),
    ]);

    expect(saveSuggestion).toHaveBeenCalledTimes(1);
    expect(first.suggestionsCreated + second.suggestionsCreated).toBe(1);
    // The loser reports an honest skipped duplicate, not a silent failure.
    expect(first.skippedDuplicates + second.skippedDuplicates).toBe(1);
    expect(
      txStatements.some((sql) => sql.includes('pg_advisory_xact_lock')),
    ).toBe(true);
  });

  it('keeps filing the rest of a scan when one row fails', async () => {
    // One malformed item must not discard the whole scan's work — the queues
    // are the deliverable, and a scan is not cheap to re-run.
    saveFinding.mockRejectedValueOnce(new Error('constraint violation'));

    const result = await service.write([bug(), improvement()], scan, 7);

    expect(result.findingsCreated).toBe(0);
    expect(result.suggestionsCreated).toBe(1);
  });

  it('puts the route and the model confidence into the finding evidence', async () => {
    // An admin reading the drawer should see how sure the pipeline was; hiding
    // it would invite more trust than the finding earned.
    await service.write([bug()], scan, 7);

    const evidence: string = saveFinding.mock.calls[0][0].evidence;
    expect(evidence).toContain('Route: /inbox');
    expect(evidence).toContain('Confidence: high');
    expect(evidence).toContain('9 rage clicks across 5 sessions');
  });
});
