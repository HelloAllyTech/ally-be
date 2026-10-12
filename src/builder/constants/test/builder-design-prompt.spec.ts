import { readFileSync } from 'fs';
import { join } from 'path';
import { renderPrd, buildBuildPrompt } from '../builder-build-prompt';
import {
  buildDesignPrompt,
  buildDesignReviewPrompt,
} from '../builder-design-prompt';
import { buildPlanPrompt } from '../builder-plan-prompt';
import { buildVerifyPrompt } from '../builder-verify-prompt';
import { DEFAULT_PLATFORM_RULES } from '../builder-platform-rules';
import { BUILDER_REPOS } from '../builder-repos.constants';
import {
  BuilderPrdDocument,
  BuilderTechnicalDesign,
  createEmptyPrdDocument,
} from '../../type/builder-prd.type';
import { createDraftingDesign } from '../../util/builder-technical-design.util';

const flat = (text: string): string => text.replace(/\s+/g, ' ');

const prd: BuilderPrdDocument = {
  ...createEmptyPrdDocument('Rich question prompts'),
  summary: 'Questions can carry formatted text.',
  requirements: [
    {
      id: 'R1',
      title: 'Formatted prompt',
      description: 'A prompt may carry bold.',
      acceptanceCriteria: ['Bold renders bold'],
    },
  ],
};

const design = (
  overrides: Partial<BuilderTechnicalDesign> = {},
): BuilderTechnicalDesign => ({
  ...createDraftingDesign(prd, 'run-1'),
  status: 'approved',
  designMd: 'Add an optional promptHtml beside prompt; prompt is unchanged.',
  scope: [{ repo: 'ally-be', files: ['src/quiz/**/*.ts'] }],
  contracts: [
    {
      name: 'payload.promptHtml',
      change: 'new optional key',
      readers: ['ally-mobile:src/screens/Quiz.tsx:88'],
    },
  ],
  compatibilityMd: 'Old clients keep reading prompt.',
  testMap: [
    {
      requirementId: 'R1',
      repo: 'ally-be',
      file: 'src/quiz/test/quiz.spec.ts',
      asserts: 'promptHtml is sanitised',
    },
  ],
  ...overrides,
});

const repos = BUILDER_REPOS.filter((repo) =>
  ['ally-be', 'ally-mobile'].includes(repo.repo),
);

describe('buildDesignPrompt', () => {
  const prompt = buildDesignPrompt({
    platformRules: '## Platform rules\n\nReleased clients lag the backend.',
    sessionId: 'session-1',
    runId: 'run-1',
    prd,
    repos,
  });

  it('puts the platform rules first', () => {
    expect(prompt.startsWith('## Platform rules')).toBe(true);
    expect(prompt).toContain('Released clients lag the backend.');
  });

  it('carries the PRD and every cloned repo', () => {
    expect(prompt).toContain('# PRD — Rich question prompts');
    expect(prompt).toContain('`repos/ally-mobile`');
  });

  it('spells out the `design` tool contract, field by field', () => {
    for (const field of [
      'designMd',
      'scope',
      'contracts',
      'compatibilityMd',
      'testMap',
      'openDecisions',
    ]) {
      expect(prompt).toContain(`"${field}"`);
    }
    expect(flat(prompt)).toContain('Submit with `design`');
    expect(flat(prompt)).toContain('call `design` again until none remain');
  });

  /** The 880e73e6 failure: a rename of a key a released client reads. */
  it('requires readers and leaves non-additive changes to a person', () => {
    expect(flat(prompt)).toContain('repo:path:line');
    expect(flat(prompt)).toContain('Default to additive.');
    expect(flat(prompt)).toContain('openDecisions');
    expect(flat(prompt)).toContain('You never edit files.');
  });

  it('falls back to the compiled rules, never to nothing', () => {
    const fallback = buildDesignPrompt({
      sessionId: 's',
      runId: 'r',
      prd,
      repos,
    });
    expect(fallback.startsWith(DEFAULT_PLATFORM_RULES.trim())).toBe(true);
  });
});

/**
 * A redraft is told what its predecessor got wrong. Session 880e73e6's first
 * design missed the component-template save path and two mobile readers; the
 * critic found all three, and a redraft that could not see that would have
 * been free to miss them again.
 */
describe('buildDesignPrompt for a redraft', () => {
  const previous = design({
    status: 'review',
    designMd: 'First draft: derive prompt in track.service only.',
    review: {
      verdict: 'concerns',
      notesMd: 'Missed track-component-template.service.ts:60.',
      at: '2026-10-12T12:32:55.325Z',
    },
  });
  const redraft = {
    ...prd,
    technicalDesign: createDraftingDesign(prd, 'run-2', previous),
  };

  it("carries the previous draft and the reviewer's findings", () => {
    const prompt = buildDesignPrompt({
      sessionId: 'session-1',
      runId: 'run-2',
      prd: redraft,
      repos,
    });
    expect(prompt).toContain('This is a redraft');
    expect(prompt).toContain('Missed track-component-template.service.ts:60.');
    expect(prompt).toContain(
      'First draft: derive prompt in track.service only.',
    );
    expect(prompt).toContain('### The review (concerns)');
  });

  it('says nothing about a redraft on a first draft', () => {
    const prompt = buildDesignPrompt({
      sessionId: 'session-1',
      runId: 'run-1',
      prd: { ...prd, technicalDesign: createDraftingDesign(prd, 'run-1') },
      repos,
    });
    expect(prompt).not.toContain('This is a redraft');
  });
});

describe('buildDesignReviewPrompt', () => {
  it('renders the rules, the submitted design and the `design_review` tool', () => {
    const prompt = buildDesignReviewPrompt({
      platformRules: '## Platform rules\n\nBe additive.',
      sessionId: 'session-1',
      runId: 'run-1',
      prd,
      repos,
      design: design({ status: 'review', openDecisions: ['Rename it?'] }),
    });

    expect(prompt.startsWith('## Platform rules')).toBe(true);
    expect(prompt).toContain('`design_review`');
    expect(prompt).toContain('ally-mobile:src/screens/Quiz.tsx:88');
    expect(prompt).toContain('Rename it?');
    expect(flat(prompt)).toContain('Missed readers.');
    expect(prompt).toContain('# PRD — Rich question prompts');
  });
});

describe('renderPrd and the technical design', () => {
  it('appends an approved design, with scope, readers and test map', () => {
    const text = renderPrd({ ...prd, technicalDesign: design() });

    expect(text).toContain('## Technical design (approved)');
    expect(text).toContain('Add an optional promptHtml beside prompt');
    expect(text).toContain('`src/quiz/**/*.ts`');
    expect(text).toContain('`ally-mobile:src/screens/Quiz.tsx:88`');
    expect(text).toContain('Old clients keep reading prompt.');
    expect(text).toContain('**R1** — `ally-be:src/quiz/test/quiz.spec.ts`');
  });

  /** A design nobody approved is a draft, not something to build from. */
  it('leaves out a design that is not approved', () => {
    const text = renderPrd({
      ...prd,
      technicalDesign: design({ status: 'review' }),
    });
    expect(text).not.toContain('Technical design');
  });

  it('reaches the build-phase prompts through the PRD', () => {
    const withDesign = { ...prd, technicalDesign: design() };
    const base = {
      sessionId: 's',
      runId: 'r',
      branchSlug: 'b',
      prd: withDesign,
      repos,
      apiBaseUrl: 'https://api.example.com',
      lessons: [],
    };

    expect(
      buildBuildPrompt({ ...base, mode: 'build', sessionUrl: 'https://x' }),
    ).toContain('## Technical design (approved)');
    expect(buildPlanPrompt(base)).toContain('## Technical design (approved)');
  });
});

describe('platform rules in the phase prompts', () => {
  it('renders them in the verifier, which has no shared header', () => {
    const prompt = buildVerifyPrompt({
      platformRules: '## Platform rules\n\nBe additive.',
      prd,
      repos,
      round: 1,
    });
    expect(prompt).toContain('Be additive.');
  });

  it('renders the compiled default when none is passed', () => {
    const prompt = buildPlanPrompt({
      sessionId: 's',
      runId: 'r',
      branchSlug: 'b',
      prd,
      repos,
      apiBaseUrl: 'https://api.example.com',
      lessons: [],
    });
    expect(prompt).toContain(DEFAULT_PLATFORM_RULES.split('\n')[0]);
  });
});

describe('DEFAULT_PLATFORM_RULES', () => {
  /** The fallback is a copy; a copy that drifts is a second set of rules. */
  it('is the text the prompt file ships', () => {
    const file = readFileSync(
      join(__dirname, '../../../prompts/builder/platform_rules.txt'),
      'utf8',
    );
    expect(DEFAULT_PLATFORM_RULES.trim()).toBe(file.trim());
  });
});
