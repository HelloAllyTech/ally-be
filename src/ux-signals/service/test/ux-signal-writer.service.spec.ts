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
    suggestionQueryBuilder = { getOne: jest.fn().mockResolvedValue(null) };

    const chainable = {
      where: () => chainable,
      andWhere: () => chainable,
      getOne: () => suggestionQueryBuilder.getOne(),
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
            save: saveSuggestion,
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
