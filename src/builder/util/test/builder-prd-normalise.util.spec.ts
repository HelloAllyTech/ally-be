import {
  asPrdText,
  asPrdTextList,
  normalisePrdDocument,
} from '../builder-prd-normalise.util';
import { createEmptyPrdDocument } from '../../type/builder-prd.type';

describe('builder PRD normalisation', () => {
  describe('asPrdText', () => {
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
});
