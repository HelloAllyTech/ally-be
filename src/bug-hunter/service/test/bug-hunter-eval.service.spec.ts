import { BugHunterEvalService, labelFinding } from '../bug-hunter-eval.service';
import { BugFinding } from '../../entity/bug-finding.entity';
import {
  BugFindingDecisionReason,
  BugFindingSource,
  BugFindingStatus,
} from '../../enum/bug-finding.enum';
import {
  BugHunterEvalLabel,
  BugHunterEvalLabelSource,
  BugHunterEvalPromptKind,
} from '../../enum/bug-hunter-eval.enum';
import { BUG_FINDING_DECLINE_SUPPRESSION_MS } from '../../constants/bug-hunter.constants';

const NOW = new Date('2026-09-23T12:00:00.000Z');
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

const finding = (overrides: Partial<BugFinding> = {}): BugFinding =>
  ({
    id: 'f-1',
    repo: 'ally-be',
    source: BugFindingSource.CODE_REVIEW,
    title: 't',
    description: 'finder words',
    originalDescription: null,
    file: 'src/a.ts',
    symbol: 'doThing',
    evidence: null,
    proven: false,
    status: BugFindingStatus.REJECTED,
    decisionReason: BugFindingDecisionReason.NOT_A_BUG,
    decidedAt: daysAgo(3),
    reversedAt: null,
    metadata: null,
    createdAt: daysAgo(10),
    updatedAt: daysAgo(3),
    ...overrides,
  }) as BugFinding;

describe('labelFinding', () => {
  it('labels a human not_a_bug rejection as a strong NOT_A_BUG', () => {
    const item = labelFinding(finding(), NOW);
    expect(item).toMatchObject({
      label: BugHunterEvalLabel.NOT_A_BUG,
      labelSource: BugHunterEvalLabelSource.HUMAN_DECLINED,
      labelStrength: 'strong',
      discoveredAt: daysAgo(10),
    });
  });

  it('labels a reversed dismissal as REAL, whatever its status still says', () => {
    // The row stays DISMISSED after a reversal; the reversal is the truth.
    const item = labelFinding(
      finding({
        status: BugFindingStatus.DISMISSED,
        reversedAt: daysAgo(1),
      }),
      NOW,
    );
    expect(item).toMatchObject({
      label: BugHunterEvalLabel.REAL,
      labelSource: BugHunterEvalLabelSource.REVERSED,
      labelStrength: 'strong',
    });
  });

  it.each([BugFindingStatus.MERGED, BugFindingStatus.RELEASED])(
    'labels a %s fix as REAL and held',
    (status) => {
      const item = labelFinding(
        finding({ status, decisionReason: null, decidedAt: null }),
        NOW,
      );
      expect(item).toMatchObject({
        label: BugHunterEvalLabel.REAL,
        labelSource: BugHunterEvalLabelSource.MERGED_HELD,
      });
    },
  );

  it('marks a shipped fix that came back as REGRESSED — the same truth, a harder bug', () => {
    const item = labelFinding(
      finding({
        status: BugFindingStatus.RELEASED,
        decisionReason: null,
        metadata: { regressed: true, regressedByFindingId: 'f-9' },
      }),
      NOW,
    );
    expect(item?.labelSource).toBe(BugHunterEvalLabelSource.REGRESSED);
    expect(item?.label).toBe(BugHunterEvalLabel.REAL);
  });

  it.each([
    BugFindingDecisionReason.WONT_FIX,
    BugFindingDecisionReason.TOO_RISKY,
    BugFindingDecisionReason.DUPLICATE,
    BugFindingDecisionReason.WRONG_REPO,
    BugFindingDecisionReason.OTHER,
  ])(
    'leaves a %s decline out — it says nothing about whether the code was wrong',
    (reason) => {
      expect(labelFinding(finding({ decisionReason: reason }), NOW)).toBeNull();
    },
  );

  it('leaves a decline with no reason recorded out', () => {
    expect(labelFinding(finding({ decisionReason: null }), NOW)).toBeNull();
  });

  describe('a verifier dismissal', () => {
    it('is a weak NOT_A_BUG once the suppression window has passed uncontradicted', () => {
      const item = labelFinding(
        finding({
          status: BugFindingStatus.DISMISSED,
          decidedAt: new Date(
            NOW.getTime() - BUG_FINDING_DECLINE_SUPPRESSION_MS - 1000,
          ),
        }),
        NOW,
      );
      expect(item).toMatchObject({
        label: BugHunterEvalLabel.NOT_A_BUG,
        labelSource: BugHunterEvalLabelSource.VERIFIER_DISMISSED,
        labelStrength: 'weak',
      });
    });

    it('is left out while the window is still open — a reversal could still arrive', () => {
      expect(
        labelFinding(
          finding({
            status: BugFindingStatus.DISMISSED,
            decidedAt: daysAgo(2),
          }),
          NOW,
        ),
      ).toBeNull();
    });
  });

  it('hands back the ORIGINAL description when an admin rewrote it', () => {
    const item = labelFinding(
      finding({
        description: 'admin rewrite, much clearer',
        originalDescription: 'what the finder actually wrote',
      }),
      NOW,
    );
    expect(item?.description).toBe('what the finder actually wrote');
  });

  it('carries the recorded verifier confidence when there was one', () => {
    expect(
      labelFinding(finding({ metadata: { confidence: 0.55 } }), NOW)
        ?.originalConfidence,
    ).toBe(0.55);
    expect(labelFinding(finding(), NOW)?.originalConfidence).toBeNull();
  });

  it('refuses a finding with no repo', () => {
    expect(labelFinding(finding({ repo: null }), NOW)).toBeNull();
  });
});

describe('BugHunterEvalService', () => {
  let service: BugHunterEvalService;
  let findingRepository: { listSettledForEval: jest.Mock };
  let evalRunRepository: {
    create: jest.Mock;
    save: jest.Mock;
    listRecent: jest.Mock;
  };

  beforeEach(() => {
    findingRepository = { listSettledForEval: jest.fn() };
    evalRunRepository = {
      create: jest.fn((row) => row),
      save: jest.fn(async (row) => ({ id: 'eval-1', ...row })),
      listRecent: jest.fn().mockResolvedValue([]),
    };
    service = new BugHunterEvalService(
      findingRepository as never,
      evalRunRepository as never,
    );
  });

  describe('buildSet', () => {
    it('drops ungradeable rows, excludes the weak tier by default, and stops at the limit', async () => {
      findingRepository.listSettledForEval.mockResolvedValue([
        finding({ id: 'human' }),
        finding({
          id: 'wontfix',
          decisionReason: BugFindingDecisionReason.WONT_FIX,
        }),
        finding({
          id: 'weak',
          status: BugFindingStatus.DISMISSED,
          decidedAt: daysAgo(45),
        }),
        finding({
          id: 'merged',
          status: BugFindingStatus.MERGED,
          decisionReason: null,
        }),
        finding({ id: 'human-2' }),
      ]);

      const set = await service.buildSet({
        repo: 'ally-be',
        limit: 2,
        now: NOW,
      });

      expect(set.items.map((i) => i.findingId)).toEqual(['human', 'merged']);
      expect(set.counts).toEqual({ real: 1, not_a_bug: 1 });
      // Oversampled so the labelling pass has room to drop what it cannot grade.
      expect(findingRepository.listSettledForEval).toHaveBeenCalledWith(
        'ally-be',
        6,
      );
    });

    it('includes the weak tier only when asked', async () => {
      findingRepository.listSettledForEval.mockResolvedValue([
        finding({
          id: 'weak',
          status: BugFindingStatus.DISMISSED,
          decidedAt: daysAgo(45),
        }),
      ]);

      const withoutWeak = await service.buildSet({ now: NOW });
      const withWeak = await service.buildSet({ includeWeak: true, now: NOW });

      expect(withoutWeak.items).toHaveLength(0);
      expect(withWeak.items).toHaveLength(1);
      expect(withWeak.items[0].labelStrength).toBe('weak');
    });
  });

  describe('recordRun', () => {
    it('stores rates to four places and leaves unreported figures null', async () => {
      await service.recordRun({
        promptKind: BugHunterEvalPromptKind.VERIFIER,
        promptHash: 'a'.repeat(64),
        model: 'claude-sonnet-5',
        itemCount: 30,
        answeredCount: 28,
        agreement: 0.85714,
        realRecall: 0.9,
        costUsd: 1.23456,
      });

      expect(evalRunRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: null,
          promptHash: 'a'.repeat(64),
          agreement: '0.8571',
          realRecall: '0.9000',
          notABugRecall: null,
          costUsd: '1.2346',
          durationMs: null,
          perSource: null,
        }),
      );
    });
  });

  describe('listRuns', () => {
    it('maps numerics back to numbers for the tab', async () => {
      evalRunRepository.listRecent.mockResolvedValue([
        {
          id: 'eval-1',
          repo: 'ally-be',
          promptKind: BugHunterEvalPromptKind.VERIFIER,
          promptHash: 'b'.repeat(64),
          model: 'claude-sonnet-5',
          setHash: null,
          itemCount: 30,
          answeredCount: 30,
          agreement: '0.8000',
          realRecall: null,
          notABugRecall: '0.7500',
          perSource: null,
          perLabelSource: null,
          calibration: null,
          costUsd: '2.5000',
          durationMs: 1200,
          notes: null,
          createdAt: NOW,
        },
      ]);

      const [row] = await service.listRuns(20, 'ally-be');

      expect(row.agreement).toBe(0.8);
      expect(row.realRecall).toBeNull();
      expect(row.costUsd).toBe(2.5);
      expect(evalRunRepository.listRecent).toHaveBeenCalledWith(20, 'ally-be');
    });
  });
});
