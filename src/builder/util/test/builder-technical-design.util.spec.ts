import {
  BuilderPrdDocument,
  BuilderTechnicalDesign,
  createEmptyPrdDocument,
} from '../../type/builder-prd.type';
import {
  computeDesignReadiness,
  createDraftingDesign,
  productHashOf,
} from '../builder-technical-design.util';

const prd = (): BuilderPrdDocument => ({
  ...createEmptyPrdDocument('Rich question prompts'),
  summary: 'Questions can carry formatted text.',
  requirements: [
    {
      id: 'R1',
      title: 'Formatted prompt',
      description: 'A question prompt may carry bold and lists.',
      acceptanceCriteria: ['Bold renders bold on web and mobile'],
    },
    {
      id: 'R2',
      title: 'Old clients',
      description: 'Released mobile builds keep showing the prompt.',
      acceptanceCriteria: ['A v1.40 client still reads `prompt`'],
    },
  ],
});

/** A design that clears every blocker, so a test can knock out one at a time. */
const designedPrd = (
  overrides: Partial<BuilderTechnicalDesign> = {},
): BuilderPrdDocument => {
  const doc = prd();
  return {
    ...doc,
    technicalDesign: {
      ...createDraftingDesign(doc, 'run-1'),
      status: 'review',
      designMd: 'Add an optional promptHtml beside prompt. '.repeat(10),
      scope: [
        { repo: 'ally-be', files: ['src/quiz/**/*.ts'] },
        { repo: 'ally-mobile', files: ['src/screens/Quiz.tsx'] },
      ],
      contracts: [
        {
          name: 'quiz_questions.payload.promptHtml',
          change: 'new optional key; prompt unchanged',
          readers: ['ally-mobile:src/screens/Quiz.tsx:88'],
        },
      ],
      compatibilityMd: 'Old clients read prompt, which still holds plain text.',
      testMap: [
        {
          requirementId: 'R1',
          repo: 'ally-be',
          file: 'src/quiz/test/quiz.service.spec.ts',
          asserts: 'promptHtml is sanitised and stored',
        },
        {
          requirementId: 'R2',
          repo: 'ally-be',
          file: 'src/quiz/test/quiz.service.spec.ts',
          asserts: 'prompt still carries the plain text',
        },
      ],
      draftedAt: '2026-10-12T10:00:00.000Z',
      ...overrides,
    },
  };
};

describe('createDraftingDesign', () => {
  it('keeps the draft it replaces, with its review, one level deep', () => {
    const doc = prd();
    const first = {
      ...createDraftingDesign(doc, 'run-1'),
      status: 'review' as const,
      designMd: 'First draft.',
      review: {
        verdict: 'concerns' as const,
        notesMd: 'Missed a reader.',
        at: 'now',
      },
    };
    const second = createDraftingDesign(doc, 'run-2', first);
    expect(second.status).toBe('drafting');
    expect(second.designMd).toBe('');
    expect(second.previous?.designMd).toBe('First draft.');
    expect(second.previous?.review?.notesMd).toBe('Missed a reader.');
    expect((second.previous as any)?.previous).toBeUndefined();
  });

  it('keeps the last real draft when the one it replaces never submitted', () => {
    const doc = prd();
    const written = {
      ...createDraftingDesign(doc, 'run-1'),
      designMd: 'Real draft.',
    };
    const failed = {
      ...createDraftingDesign(doc, 'run-2', written),
      status: 'failed' as const,
    };
    expect(createDraftingDesign(doc, 'run-3', failed).previous?.designMd).toBe(
      'Real draft.',
    );
  });

  it('has no previous draft the first time', () => {
    expect(createDraftingDesign(prd(), 'run-1').previous).toBeNull();
  });
});

describe('productHashOf', () => {
  it('is the same for the same product whatever the key order', () => {
    const doc = prd();
    const reordered = Object.fromEntries(
      Object.entries(doc).reverse(),
    ) as unknown as BuilderPrdDocument;

    expect(productHashOf(reordered)).toBe(productHashOf(doc));
    expect(productHashOf(doc)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores the design itself and the interviewer progress flags', () => {
    const doc = prd();
    const before = productHashOf(doc);

    expect(productHashOf({ ...doc, ui: { interview: { scope: true } } })).toBe(
      before,
    );
    expect(productHashOf(designedPrd())).toBe(before);
  });

  it('moves when anything a person decided moves', () => {
    const doc = prd();
    const edited = { ...doc, summary: `${doc.summary} And tables.` };

    expect(productHashOf(edited)).not.toBe(productHashOf(doc));
  });
});

describe('computeDesignReadiness', () => {
  it('is ready when every blocker is cleared', () => {
    expect(computeDesignReadiness(designedPrd())).toEqual({
      ready: true,
      stale: false,
      blockers: [],
    });
  });

  it('blocks with no design at all', () => {
    const readiness = computeDesignReadiness(prd());
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers[0]).toMatch(/No technical design yet/);
  });

  it('blocks while drafting or failed, unless told to ignore the status', () => {
    expect(
      computeDesignReadiness(designedPrd({ status: 'drafting' })).blockers,
    ).toEqual(['The design is still being drafted.']);
    expect(
      computeDesignReadiness(designedPrd({ status: 'failed', error: 'oom' }))
        .blockers[0],
    ).toMatch(/failed: oom/);
    expect(
      computeDesignReadiness(designedPrd({ status: 'drafting' }), {
        ignoreStatus: true,
      }).ready,
    ).toBe(true);
  });

  it('blocks a design too thin to build from', () => {
    const { blockers } = computeDesignReadiness(
      designedPrd({ designMd: 'Add a field.' }),
    );
    expect(blockers).toEqual([expect.stringMatching(/designMd is too thin/)]);
  });

  it('blocks an empty scope, an unknown repo and a repo with no files', () => {
    expect(computeDesignReadiness(designedPrd({ scope: [] })).blockers).toEqual(
      [expect.stringMatching(/scope is empty/)],
    );
    expect(
      computeDesignReadiness(
        designedPrd({ scope: [{ repo: 'not-a-repo', files: ['x.ts'] }] }),
      ).blockers,
    ).toEqual([expect.stringMatching(/cannot work in: not-a-repo/)]);
    expect(
      computeDesignReadiness(
        designedPrd({ scope: [{ repo: 'ally-be', files: ['  '] }] }),
      ).blockers,
    ).toEqual([expect.stringMatching(/no files for: ally-be/)]);
  });

  /** Zero readers means the search was not done — the 880e73e6 failure. */
  it('blocks a contract with no readers', () => {
    const { blockers } = computeDesignReadiness(
      designedPrd({
        contracts: [{ name: 'payload.prompt', change: 'renamed', readers: [] }],
      }),
    );
    expect(blockers).toEqual([
      expect.stringMatching(/No readers found for: payload\.prompt/),
    ]);
  });

  it('blocks changed contracts with no compatibility story', () => {
    const { blockers } = computeDesignReadiness(
      designedPrd({ compatibilityMd: '' }),
    );
    expect(blockers).toEqual([
      expect.stringMatching(/compatibilityMd is empty/),
    ]);
    // No contracts changed, nothing to be compatible with.
    expect(
      computeDesignReadiness(
        designedPrd({ contracts: [], compatibilityMd: '' }),
      ).ready,
    ).toBe(true);
  });

  it('blocks a requirement with no mapped test, naming it', () => {
    const design = designedPrd().technicalDesign!;
    const { blockers } = computeDesignReadiness(
      designedPrd({ testMap: design.testMap.slice(0, 1) }),
    );
    expect(blockers).toEqual([expect.stringMatching(/no test for: R2\./)]);
  });

  it('blocks on open decisions', () => {
    const { blockers } = computeDesignReadiness(
      designedPrd({ openDecisions: ['Rename prompt to promptHtml?'] }),
    );
    expect(blockers).toEqual([expect.stringMatching(/1 open decision/)]);
  });

  it('is stale, and blocked, once the PRD changes under it', () => {
    const doc = designedPrd();
    const edited = { ...doc, goals: 'Something nobody designed for.' };

    const readiness = computeDesignReadiness(edited);

    expect(readiness.stale).toBe(true);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual([
      expect.stringMatching(/PRD changed after this design was drafted/),
    ]);
  });
});
