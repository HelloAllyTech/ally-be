import {
  BUG_HUNTER_PLAYBOOKS,
  playbooksFor,
  renderPlaybooks,
} from '../bug-hunter-playbooks';

describe('Bug Hunter playbooks', () => {
  it('serves the content-translation playbook first for the 2026-10-12 simulations report', () => {
    const [first] = playbooksFor(
      'When a learner selects Marathi, Hindi or Kannada as the global language, the Simulations tab still shows every simulation title and description in English.',
    );
    expect(first.id).toBe('content-not-translated');
    expect(first.notThis).toMatch(/i18n t\(\)/);
  });

  it('tells a label from content', () => {
    const ids = playbooksFor(
      'The Close button tooltip on the Report a bug dialog stays in English after switching to Marathi',
    ).map((p) => p.id);
    expect(ids).toContain('label-not-translated');
  });

  it('matches the permission, render-loop and server-error classes', () => {
    expect(
      playbooksFor('Trainer role gets a 403 forbidden on the voices page')[0]
        .id,
    ).toBe('permission-denied-for-a-role');
    expect(
      playbooksFor('Login page goes blank and keeps reloading in a loop').map(
        (p) => p.id,
      ),
    ).toContain('blank-page-or-render-loop');
    expect(
      playbooksFor(
        'Submitting the form says Something went wrong (DATABASE_ERROR)',
      )[0].id,
    ).toBe('server-error');
  });

  it('serves nothing for a bug no playbook covers, and at most two otherwise', () => {
    expect(playbooksFor('The PDF export rotates landscape pages')).toEqual([]);
    expect(
      playbooksFor(
        'blank empty missing 403 permission role english translated marathi simulation title',
      ).length,
    ).toBeLessThanOrEqual(2);
  });

  it('gives every playbook the five parts a study needs, and renders them as advice', () => {
    for (const p of BUG_HUNTER_PLAYBOOKS) {
      expect(
        [p.firstCheck, p.evidence, p.usualFix, p.notThis, p.learnedFrom].every(
          (s) => s.length > 20,
        ),
      ).toBe(true);
    }
    const text = renderPlaybooks(BUG_HUNTER_PLAYBOOKS.slice(0, 1)).join('\n');
    expect(text).toContain('## Playbooks for bugs like this one');
    expect(text).toContain('not orders');
    expect(renderPlaybooks([])).toEqual([]);
  });
});
