import {
  asPrdText,
  asPrdTextList,
  createPrdNormaliseDiagnostics,
  normalisePrdDocument,
} from '../builder-prd-normalise.util';
import { createEmptyPrdDocument } from '../../type/builder-prd.type';

describe('builder PRD normalisation', () => {
  describe('asPrdText', () => {
    /**
     * Seen in production: Goals, Non-goals, the test plan and the technical
     * plan all rendered `\n` as two visible characters, because the model
     * wrote the escape sequence into the JSON string rather than a newline in
     * it. The PRD is read by a person deciding whether to build and by the
     * agent that implements it literally, so both were reading a degraded
     * document.
     */
    it('repairs a field the model escaped end to end', () => {
      expect(asPrdText('Goal one.\\n- Goal two.\\n- Goal three.')).toBe(
        'Goal one.\n- Goal two.\n- Goal three.',
      );
    });

    it('leaves real newlines alone', () => {
      expect(asPrdText('Real line.\nAnother.')).toBe('Real line.\nAnother.');
    });

    /**
     * The guard that stops a repair becoming a corruption. A field mixing both
     * is one where the model got newlines right and MEANT the backslash — a
     * technical plan saying "split on \n" is the obvious case, and rewriting
     * it would change an instruction rather than fix a format.
     */
    it('leaves a deliberate escape sequence alone when real newlines exist', () => {
      const plan = 'Split the payload on \\n before parsing.\nThen validate.';
      expect(asPrdText(plan)).toBe(plan);
    });

    it('leaves plain prose untouched', () => {
      expect(asPrdText('No newlines at all.')).toBe('No newlines at all.');
    });

    it('passes strings through untouched', () => {
      expect(asPrdText('Which tenant owns this?')).toBe(
        'Which tenant owns this?',
      );
    });

    it('reads the words out of an object written where text belongs', () => {
      // The shape that crashed the admin panel: React throws on an object
      // child, so the words have to come out of it rather than be dropped.
      expect(asPrdText({ id: 'q1', text: 'Which tenant owns this?' })).toBe(
        'Which tenant owns this?',
      );
      expect(asPrdText({ id: 'r1', label: 'Per-tenant toggle' })).toBe(
        'Per-tenant toggle',
      );
    });

    it('falls back to visible JSON when an object carries no readable field', () => {
      expect(asPrdText({ severity: 3 })).toBe('{"severity":3}');
    });

    it('joins an array written where one string belongs', () => {
      expect(asPrdText(['First point', 'Second point'])).toBe(
        'First point\nSecond point',
      );
    });

    it('renders nullish and non-string scalars as text', () => {
      expect(asPrdText(null)).toBe('');
      expect(asPrdText(undefined)).toBe('');
      expect(asPrdText(4)).toBe('4');
      expect(asPrdText(false)).toBe('false');
    });
  });

  describe('asPrdTextList', () => {
    it('flattens object rows and drops empties', () => {
      expect(
        asPrdTextList([
          { id: 'q1', text: 'Which tenant owns this?' },
          '',
          'Does it need a migration?',
          null,
        ]),
      ).toEqual(['Which tenant owns this?', 'Does it need a migration?']);
    });

    it('keeps a bare string as a one-item list', () => {
      // Dropping it would silently clear a readiness blocker.
      expect(asPrdTextList('Which tenant owns this?')).toEqual([
        'Which tenant owns this?',
      ]);
    });

    it('returns an empty list for nothing at all', () => {
      expect(asPrdTextList(undefined)).toEqual([]);
      expect(asPrdTextList({})).toEqual([]);
    });
  });

  describe('normalisePrdDocument', () => {
    it('leaves a well-formed document unchanged', () => {
      const doc = createEmptyPrdDocument('Per-tenant toggles');
      doc.openQuestions = ['Which tenant owns this?'];
      doc.requirements = [
        {
          id: 'R1',
          title: 'Toggle',
          description: 'A per-tenant switch',
          acceptanceCriteria: ['Admins see it', 'Learners do not'],
        },
      ];
      expect(normalisePrdDocument(doc)).toEqual(doc);
    });

    it('coerces the shapes the agent actually gets wrong', () => {
      const result = normalisePrdDocument({
        title: { id: 't', text: 'Per-tenant toggles' },
        openQuestions: [{ id: 'q1', text: 'Which tenant owns this?' }],
        requirements: [
          {
            id: 'R1',
            title: 'Toggle',
            description: 'A per-tenant switch',
            acceptanceCriteria: [{ id: 'ac1', text: 'Admins see it' }],
          },
        ],
        assumptions: [{ id: 'A1', text: 'One org at a time', status: 'maybe' }],
        technicalPlan: {
          repos: [{ repo: 'ally-be', changesMd: 'New module' }],
        },
      });

      expect(result.title).toBe('Per-tenant toggles');
      expect(result.openQuestions).toEqual(['Which tenant owns this?']);
      expect(result.requirements[0].acceptanceCriteria).toEqual([
        'Admins see it',
      ]);
      // An unreadable status is unconfirmed: it is exactly the assumption a
      // human should still be looking at.
      expect(result.assumptions[0].status).toBe('unconfirmed');
      expect(result.technicalPlan.dataModelMd).toBe('');
    });

    it('keeps every declared key present so RFC-6902 replace resolves', () => {
      const result = normalisePrdDocument({ problem: 'Only this' });
      expect(Object.keys(result).sort()).toEqual(
        Object.keys(createEmptyPrdDocument()).sort(),
      );
      expect(result.problem).toBe('Only this');
    });

    it('carries unknown keys through rather than dropping agent notes', () => {
      const result = normalisePrdDocument({
        risks: 'Rollout is manual',
      }) as unknown as Record<string, unknown>;
      expect(result.risks).toBe('Rollout is manual');
    });

    it('survives a draft that is not an object at all', () => {
      expect(normalisePrdDocument(null).openQuestions).toEqual([]);
      expect(normalisePrdDocument('broken').requirements).toEqual([]);
    });
  });

  describe('near-miss key names on structured rows', () => {
    it('recovers a repo plan written under synonyms', () => {
      // The exact shape that cost a live session its whole budget: the plan
      // was stored as { repo: '', changesMd: '' }, the patch reported success,
      // and the readiness blocker never moved.
      const result = normalisePrdDocument({
        technicalPlan: {
          repos: [
            { repoName: 'ally-be', changes: 'Lower the fix-session timeout.' },
            { targetRepo: 'ally-web', changesMarkdown: 'No change.' },
          ],
        },
      });

      expect(result.technicalPlan.repos).toEqual([
        { repo: 'ally-be', changesMd: 'Lower the fix-session timeout.' },
        { repo: 'ally-web', changesMd: 'No change.' },
      ]);
    });

    it('ignores case and separators, so changes_md lands', () => {
      const result = normalisePrdDocument({
        technicalPlan: {
          repos: [{ Repo: 'ally-ai', changes_md: 'RAG tweak' }],
        },
      });
      expect(result.technicalPlan.repos[0]).toEqual({
        repo: 'ally-ai',
        changesMd: 'RAG tweak',
      });
    });

    it('prefers the declared key, and skips it only when it is empty', () => {
      const both = normalisePrdDocument({
        technicalPlan: {
          repos: [{ repo: 'ally-be', repoName: 'ally-web', changesMd: 'x' }],
        },
      });
      expect(both.technicalPlan.repos[0].repo).toBe('ally-be');

      // An agent that wrote both an empty declared key and a populated synonym
      // meant the synonym.
      const empty = normalisePrdDocument({
        technicalPlan: {
          repos: [{ repo: '', repoName: 'ally-web', changesMd: 'x' }],
        },
      });
      expect(empty.technicalPlan.repos[0].repo).toBe('ally-web');
    });

    it('recovers requirement and assumption synonyms too', () => {
      const result = normalisePrdDocument({
        requirements: [
          { id: 'R1', name: 'Precheck step', criteria: ['Skips in ~30s'] },
        ],
        assumptions: [
          { id: 'A1', assumption: 'Cron stays hourly', confirmed: true },
        ],
      });

      expect(result.requirements[0].title).toBe('Precheck step');
      expect(result.requirements[0].acceptanceCriteria).toEqual([
        'Skips in ~30s',
      ]);
      expect(result.assumptions[0].text).toBe('Cron stays hourly');
      // `confirmed: true` says the same thing as the sentinel; blocking
      // readiness on it would hold up an assumption the admin had settled.
      expect(result.assumptions[0].status).toBe('confirmed');
    });

    it('reports what it recovered and what it could not', () => {
      const diagnostics = createPrdNormaliseDiagnostics();
      normalisePrdDocument(
        {
          technicalPlan: {
            repos: [
              {
                repoName: 'ally-be',
                changesMd: 'Lower the timeout.',
                files: 'src/bug-hunter/constants/bug-fix-session.constants.ts',
              },
            ],
          },
        },
        diagnostics,
      );

      expect(diagnostics.recovered).toEqual([
        {
          path: '/technicalPlan/repos/0',
          wrote: 'repoName',
          storedAs: 'repo',
        },
      ]);
      // The only warning the agent will get that these words are not in the
      // document.
      expect(diagnostics.ignored).toEqual([
        { path: '/technicalPlan/repos/0', keys: ['files'] },
      ]);
    });

    it('says nothing about a correctly-shaped document', () => {
      const diagnostics = createPrdNormaliseDiagnostics();
      normalisePrdDocument(
        {
          requirements: [
            {
              id: 'R1',
              title: 'Precheck',
              description: 'A first step',
              acceptanceCriteria: ['Skips in ~30s'],
            },
          ],
          technicalPlan: { repos: [{ repo: 'ally-be', changesMd: 'Timeout' }] },
        },
        diagnostics,
      );
      expect(diagnostics).toEqual({ recovered: [], ignored: [] });
    });

    it('keeps a bare string entry quiet rather than warning about its own scaffolding', () => {
      const diagnostics = createPrdNormaliseDiagnostics();
      const result = normalisePrdDocument(
        { technicalPlan: { repos: ['Lower the timeout in ally-be'] } },
        diagnostics,
      );
      expect(result.technicalPlan.repos[0].changesMd).toBe(
        'Lower the timeout in ally-be',
      );
      expect(diagnostics.ignored).toEqual([]);
    });
  });
});

/**
 * Evidence on an assumption.
 *
 * `status: 'confirmed'` was a bare claim — confirmed by what, nobody could
 * say. Now that the interview can consult production numbers, CloudWatch and
 * Bug Hunter's findings, a confirmation can carry its basis, in the document a
 * human reviews rather than in a log they never open.
 *
 * The rejection cases matter most. A half-read citation looks like provenance
 * and carries none, which is worse for a reviewer than no citation at all.
 */
describe('normalisePrdDocument — assumption evidence', () => {
  const withAssumption = (assumption: Record<string, unknown>) =>
    normalisePrdDocument({
      assumptions: [{ id: 'a1', text: 'This path is used', ...assumption }],
    } as never).assumptions[0];

  it('keeps a well-formed citation', () => {
    const result = withAssumption({
      status: 'confirmed',
      evidence: {
        source: 'analytics_ask',
        detail: '412 sessions in the last 30 days',
        at: '2026-09-14T00:00:00.000Z',
      },
    });

    expect(result.evidence).toEqual({
      source: 'analytics_ask',
      detail: '412 sessions in the last 30 days',
      at: '2026-09-14T00:00:00.000Z',
    });
  });

  it('stamps the date when the agent omits it', () => {
    // The date is what makes a stale figure visible six months later, so it is
    // not left to the model to remember.
    const result = withAssumption({
      evidence: { source: 'prod_errors', detail: '30 failures a day' },
    });

    expect(result.evidence?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('drops a citation with no source rather than storing half of one', () => {
    expect(
      withAssumption({ evidence: { detail: 'something was measured' } })
        .evidence,
    ).toBeUndefined();
  });

  it('drops a citation with no finding — "I looked" is not evidence', () => {
    expect(
      withAssumption({ evidence: { source: 'analytics_ask' } }).evidence,
    ).toBeUndefined();
  });

  it('leaves an assumption a human confirmed with no evidence at all', () => {
    // An admin saying "we have decided to support this" is not weaker
    // evidence, it is a different kind. Absent means "not measured".
    const result = withAssumption({ status: 'confirmed' });

    expect(result.status).toBe('confirmed');
    expect(result.evidence).toBeUndefined();
  });
});
