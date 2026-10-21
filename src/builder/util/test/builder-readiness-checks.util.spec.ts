import {
  citedPathMatchesRead,
  citedPaths,
  isAcknowledgement,
  mentionsId,
  mentionsIdentifier,
  reposATestPlanTouches,
  reposOwningALine,
} from '../builder-readiness-checks.util';

describe('builder readiness checks', () => {
  describe('reposOwningALine', () => {
    it('reads the repos a section gives a line of work to', () => {
      expect(
        reposOwningALine(
          '- **ally-web**: the rating control.\n- `ally-mobile` — the same, in the app.',
        ),
      ).toEqual(['ally-web', 'ally-mobile']);
    });

    it('ignores a repo named only to rule it out', () => {
      expect(
        reposOwningALine(
          '- ally-be: the count. Nothing in ally-web has to change.',
        ),
      ).toEqual(['ally-be']);
    });
  });

  describe('reposATestPlanTouches', () => {
    /** Session 2bc3a5cf, v8: an ally-ai test plan for a repo the plan never touched. */
    it('counts a repo-rooted test path as a test in that repo', () => {
      expect(
        reposATestPlanTouches(
          'Add `ally-ai/tests/test_challenger_job.py` for the new job, and a ' +
            'jest spec in ally-be.',
        ),
      ).toEqual(['ally-ai']);
    });

    it('counts a repo owning a line of the test plan', () => {
      expect(
        reposATestPlanTouches('- ally-web: vitest for DebriefTab.'),
      ).toEqual(['ally-web']);
    });
  });

  describe('mentionsId', () => {
    it('matches an id as a whole token', () => {
      expect(mentionsId('Store the rating (R1, R3).', 'R1')).toBe(true);
      expect(mentionsId('R3: attribution', 'R3')).toBe(true);
    });

    it('does not match a longer id that starts the same way', () => {
      expect(mentionsId('Covers R10 and R11.', 'R1')).toBe(false);
    });
  });

  describe('mentionsIdentifier', () => {
    it('matches a component name, not a longer one or prose', () => {
      expect(
        mentionsIdentifier('Add thumbs to `DebriefTab`.', 'DebriefTab'),
      ).toBe(true);
      expect(mentionsIdentifier('DebriefTabs list', 'DebriefTab')).toBe(false);
      expect(mentionsIdentifier('the debrief tab', 'DebriefTab')).toBe(false);
    });
  });

  describe('citedPaths', () => {
    it('finds backticked and bare file paths', () => {
      expect(
        citedPaths(
          'DEBRIEF_RUBRIC lives in `ally-be/src/skill-experiment/constants/skill-experiment.constants.ts`; ' +
            'the web tab is DebriefTab.tsx and docs/skill-experiments.md explains it.',
        ).sort(),
      ).toEqual(
        [
          'ally-be/src/skill-experiment/constants/skill-experiment.constants.ts',
          'DebriefTab.tsx',
          'docs/skill-experiments.md',
        ].sort(),
      );
    });

    it('reads the evidence log spelling, repo:path', () => {
      expect(citedPaths('Read ally-web:apps/x/DebriefTab.tsx.')).toEqual([
        'ally-web/apps/x/DebriefTab.tsx',
      ]);
    });

    it('leaves out slash phrases and URLs', () => {
      expect(
        citedPaths(
          'A thumbs-up/down on web/mobile; see https://tech.helloally.ai/#/wiki/x.md',
        ),
      ).toEqual([]);
    });
  });

  describe('citedPathMatchesRead', () => {
    const read =
      'ally-be:src/skill-experiment/constants/skill-experiment.constants.ts';

    it('matches the full path with or without the repo', () => {
      expect(
        citedPathMatchesRead(
          'src/skill-experiment/constants/skill-experiment.constants.ts',
          read,
        ),
      ).toBe(true);
      expect(
        citedPathMatchesRead(
          'ally-be/src/skill-experiment/constants/skill-experiment.constants.ts',
          read,
        ),
      ).toBe(true);
    });

    it('matches a directory that holds a file that was read', () => {
      expect(citedPathMatchesRead('src/skill-experiment/', read)).toBe(true);
    });

    it('matches a bare file name on its base name only', () => {
      expect(citedPathMatchesRead('skill-experiment.constants.ts', read)).toBe(
        true,
      );
      expect(citedPathMatchesRead('constants.ts', read)).toBe(false);
    });

    /** Session 2bc3a5cf guessed `entities/` where the search had said `entity/`. */
    it('does not match a sibling directory', () => {
      expect(
        citedPathMatchesRead(
          'src/skill-experiment/entities/skill-experiment.entity.ts',
          'ally-be:src/skill-experiment/entity/skill-experiment.entity.ts',
        ),
      ).toBe(false);
    });
  });

  describe('isAcknowledgement', () => {
    it.each([
      'ok',
      'Thanks!',
      'looks good, go ahead',
      'Great. Continue.',
      'ok and thanks',
    ])('treats "%s" as an acknowledgement', (text) =>
      expect(isAcknowledgement(text)).toBe(true),
    );

    it.each([
      'no, mobile too',
      'you have everything, write it',
      'Auto-improve already writes challengers',
      'ok but drop R3',
    ])('treats "%s" as something to apply', (text) =>
      expect(isAcknowledgement(text)).toBe(false),
    );
  });
});
