import { JsonPatchError } from 'src/common/util/json-patch.util';
import { createEmptyPrdDocument } from '../../type/builder-prd.type';
import {
  applyPrdEdit,
  applyTolerantPrdPatch,
  PrdEditError,
  structuralRegressions,
} from '../builder-prd-edits.util';

/**
 * Edits by id: what an entry IS, not where it sits. The case they exist for is
 * session 2bc3a5cf's last edit — a requirement removed, then "the next one"
 * patched by its old index, which failed under a reply saying "revised".
 */
describe('PRD edits by id', () => {
  const draft = () => ({
    ...createEmptyPrdDocument('Debrief rating'),
    goals: 'Learners rate the debrief.',
    requirements: [
      {
        id: 'R1',
        title: 'Rating',
        description: 'Thumbs',
        acceptanceCriteria: ['a'],
      },
      {
        id: 'R2',
        title: 'Attribution',
        description: 'Variant',
        acceptanceCriteria: [],
      },
      {
        id: 'R3',
        title: 'Input',
        description: 'Judge',
        acceptanceCriteria: [],
      },
    ],
    assumptions: [
      { id: 'A1', text: 'Web only', status: 'unconfirmed' as const },
    ],
    technicalPlan: {
      repos: [{ repo: 'ally-web', changesMd: '(R1) the button' }],
      dataModelMd: '',
      apiMd: '',
    },
  });

  describe('applyPrdEdit', () => {
    it('removes one requirement and then edits another by id — nothing shifts', () => {
      const removed = applyPrdEdit(draft(), {
        kind: 'remove_requirement',
        id: 'R2',
      });
      const edited = applyPrdEdit(removed, {
        kind: 'upsert_requirement',
        id: 'R3',
        acceptanceCriteria: [
          'The judge score and the rating both feed Auto-improve',
        ],
      });
      expect(edited.requirements.map((row) => row.id)).toEqual(['R1', 'R3']);
      expect(edited.requirements[1]).toEqual({
        id: 'R3',
        title: 'Input',
        description: 'Judge',
        acceptanceCriteria: [
          'The judge score and the rating both feed Auto-improve',
        ],
      });
    });

    it('adds a requirement under a new id, keeping fields it was not given', () => {
      const next = applyPrdEdit(draft(), {
        kind: 'upsert_requirement',
        id: 'R4',
        title: 'Mobile rating',
      });
      expect(next.requirements[3]).toEqual({
        id: 'R4',
        title: 'Mobile rating',
        description: '',
        acceptanceCriteria: [],
      });
    });

    it('matches ids without regard to case or spacing', () => {
      const next = applyPrdEdit(draft(), {
        kind: 'upsert_requirement',
        id: ' r1 ',
        title: 'Thumbs rating',
      });
      expect(next.requirements).toHaveLength(3);
      expect(next.requirements[0].title).toBe('Thumbs rating');
      expect(next.requirements[0].id).toBe('R1');
    });

    it('refuses a new requirement with nothing in it, naming the ids that exist', () => {
      expect(() =>
        applyPrdEdit(draft(), { kind: 'upsert_requirement', id: 'R9' }),
      ).toThrow(/no requirement R9 yet \(ids: R1, R2, R3\)/);
    });

    it('refuses to remove an id that is not there', () => {
      expect(() =>
        applyPrdEdit(draft(), { kind: 'remove_requirement', id: 'R7' }),
      ).toThrow(PrdEditError);
    });

    it('needs an id', () => {
      expect(() =>
        applyPrdEdit(draft(), {
          kind: 'upsert_requirement',
          id: '  ',
          title: 'x',
        }),
      ).toThrow(/needs an id/);
    });

    it('upserts a repo plan by repo name, and refuses one Builder cannot work in', () => {
      const added = applyPrdEdit(draft(), {
        kind: 'set_repo_plan',
        repo: 'ALLY-MOBILE',
        changesMd: '(R1) the button on DebriefTab',
      });
      expect(added.technicalPlan.repos.map((plan) => plan.repo)).toEqual([
        'ally-web',
        'ally-mobile',
      ]);
      const replaced = applyPrdEdit(added, {
        kind: 'set_repo_plan',
        repo: 'ally-web',
        changesMd: '(R1) the button, (R2) nothing',
      });
      expect(replaced.technicalPlan.repos[0].changesMd).toContain('(R2)');
      expect(() =>
        applyPrdEdit(draft(), {
          kind: 'set_repo_plan',
          repo: 'some-repo',
          changesMd: 'x',
        }),
      ).toThrow(/not a repo Builder can work in/);
      expect(() =>
        applyPrdEdit(draft(), {
          kind: 'set_repo_plan',
          repo: 'ally-be',
          changesMd: ' ',
        }),
      ).toThrow(/changesMd is empty/);
    });

    it('removes a repo plan by name', () => {
      const next = applyPrdEdit(draft(), {
        kind: 'remove_repo_plan',
        repo: 'ally-web',
      });
      expect(next.technicalPlan.repos).toEqual([]);
      expect(() =>
        applyPrdEdit(next, { kind: 'remove_repo_plan', repo: 'ally-web' }),
      ).toThrow(/not in the technical plan/);
    });

    it('sets and appends prose sections, including the two inside the technical plan', () => {
      const replaced = applyPrdEdit(draft(), {
        kind: 'set_section',
        section: 'summary',
        text: 'Rate the debrief.',
      });
      expect(replaced.summary).toBe('Rate the debrief.');
      const appended = applyPrdEdit(replaced, {
        kind: 'set_section',
        section: 'goals',
        text: 'Ratings reach Auto-improve.',
        mode: 'append',
      });
      expect(appended.goals).toBe(
        'Learners rate the debrief.\nRatings reach Auto-improve.',
      );
      const plan = applyPrdEdit(appended, {
        kind: 'set_section',
        section: 'dataModelMd',
        text: 'A rating column.',
      });
      expect(plan.technicalPlan.dataModelMd).toBe('A rating column.');
      expect(() =>
        applyPrdEdit(draft(), {
          kind: 'set_section',
          section: 'requirements',
          text: 'x',
        }),
      ).toThrow(/not a section set_section can write/);
    });

    it('confirms an assumption without restating it', () => {
      const next = applyPrdEdit(draft(), {
        kind: 'upsert_assumption',
        id: 'A1',
        status: 'confirmed',
      });
      expect(next.assumptions[0]).toEqual({
        id: 'A1',
        text: 'Web only',
        status: 'confirmed',
      });
    });

    it('replaces the open questions as a list of sentences', () => {
      const next = applyPrdEdit(draft(), {
        kind: 'set_open_questions',
        questions: ['Guardrail or weight?', { text: 'Which target?' }],
      });
      expect(next.openQuestions).toEqual([
        'Guardrail or weight?',
        'Which target?',
      ]);
    });

    it('never mutates the draft it was given', () => {
      const original = draft();
      const snapshot = JSON.stringify(original);
      applyPrdEdit(original, { kind: 'remove_requirement', id: 'R1' });
      expect(JSON.stringify(original)).toBe(snapshot);
    });
  });

  describe('applyTolerantPrdPatch', () => {
    it('resolves an id as an array segment, against the draft as each op finds it', () => {
      const next = applyTolerantPrdPatch(draft(), [
        { op: 'remove', path: '/requirements/R2' },
        {
          op: 'replace',
          path: '/requirements/R3/title',
          value: 'Ratings as input',
        },
      ]);
      expect(next.requirements.map((row) => [row.id, row.title])).toEqual([
        ['R1', 'Rating'],
        ['R3', 'Ratings as input'],
      ]);
    });

    it('addresses a repo plan by repo name', () => {
      const next = applyTolerantPrdPatch(draft(), [
        {
          op: 'replace',
          path: '/technicalPlan/repos/ally-web/changesMd',
          value: '(R1) the button',
        },
      ]);
      expect(next.technicalPlan.repos[0].changesMd).toBe('(R1) the button');
    });

    it('treats a whole row added by a new id as an append, and by an existing id as a replace', () => {
      const added = applyTolerantPrdPatch(draft(), [
        {
          op: 'add',
          path: '/requirements/R4',
          value: {
            title: 'Mobile',
            description: 'App',
            acceptanceCriteria: [],
          },
        },
      ]);
      expect(added.requirements[3]).toMatchObject({
        id: 'R4',
        title: 'Mobile',
      });
      const replaced = applyTolerantPrdPatch(added, [
        {
          op: 'add',
          path: '/requirements/R1',
          value: {
            id: 'R1',
            title: 'Thumbs',
            description: 'x',
            acceptanceCriteria: [],
          },
        },
      ]);
      expect(replaced.requirements).toHaveLength(4);
      expect(replaced.requirements[0].title).toBe('Thumbs');
    });

    it('appends a line when a prose field is addressed like a list', () => {
      const next = applyTolerantPrdPatch(draft(), [
        { op: 'add', path: '/goals/-', value: 'Ratings reach Auto-improve.' },
      ]);
      expect(next.goals).toBe(
        'Learners rate the debrief.\nRatings reach Auto-improve.',
      );
    });

    it('reports a missing id with what is there, at the failing op', () => {
      let caught: unknown;
      try {
        applyTolerantPrdPatch(draft(), [
          { op: 'replace', path: '/summary', value: 'x' },
          { op: 'replace', path: '/requirements/R9/title', value: 'x' },
        ]);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(JsonPatchError);
      expect((caught as JsonPatchError).opIndex).toBe(1);
      expect((caught as Error).message).toMatch(
        /No requirement "R9" — present: R1, R2, R3/,
      );
    });

    it('leaves numeric pointers exactly as RFC 6902 has them', () => {
      const next = applyTolerantPrdPatch(draft(), [
        { op: 'remove', path: '/requirements/0' },
      ]);
      expect(next.requirements.map((row) => row.id)).toEqual(['R2', 'R3']);
    });
  });

  describe('structuralRegressions', () => {
    it('flags a write that adds a requirement with no id or a plan with no repo', () => {
      const before = draft();
      const after = {
        ...before,
        requirements: [
          ...before.requirements,
          { id: '', title: 'x', description: '', acceptanceCriteria: [] },
        ],
        technicalPlan: {
          ...before.technicalPlan,
          repos: [...before.technicalPlan.repos, { repo: '', changesMd: 'x' }],
        },
      };
      const problems = structuralRegressions(before, after);
      expect(problems).toHaveLength(2);
      expect(problems[0]).toMatch(/needs an id/);
      expect(problems[1]).toMatch(/needs a repo/);
    });

    it('lets a document that already had such a row be edited', () => {
      const before = {
        ...draft(),
        technicalPlan: {
          repos: [{ repo: '', changesMd: 'x' }],
          dataModelMd: '',
          apiMd: '',
        },
      };
      const after = { ...before, summary: 'Changed' };
      expect(structuralRegressions(before, after)).toEqual([]);
    });
  });
});
