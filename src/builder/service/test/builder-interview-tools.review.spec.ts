import { BuilderMessageRole } from '../../enum/builder.enum';
import { BuilderInterviewToolsService } from '../builder-interview-tools.service';

/**
 * The interview's side of the cold review: `update_prd` is where a PRD first
 * reads ready, so it settles readiness (which may run the reviewer), and the
 * agent may record a dismissal only in the admin's own words.
 */
describe('BuilderInterviewToolsService — PRD review', () => {
  const ready = { score: 100, ready: true, sections: [], blockers: [] };

  const build = (latestAdminMessage: string) => {
    const prdService = {
      applyPatch: jest.fn().mockResolvedValue({
        doc: { id: 'doc-2', draft: { summary: 'x' }, versionNumber: 9 },
        diagnostics: { recovered: [], ignored: [] },
      }),
    };
    const readiness = {
      settle: jest.fn().mockResolvedValue(ready),
      assess: jest.fn().mockResolvedValue(ready),
    };
    const reviewService = { dismiss: jest.fn().mockResolvedValue({}) };
    const messageRepository = {
      listBySession: jest.fn().mockResolvedValue([
        { role: BuilderMessageRole.USER, content: 'Earlier words.' },
        {
          role: BuilderMessageRole.ASSISTANT,
          content: 'F2 says mobile is missing.',
        },
        { role: BuilderMessageRole.USER, content: latestAdminMessage },
      ]),
    };
    const service = new BuilderInterviewToolsService(
      prdService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { recordToolResult: jest.fn() } as any,
      readiness as any,
      reviewService as any,
      messageRepository as any,
    );
    const context = {
      session: { id: 'session-1' },
      doc: { id: 'doc-1', review: null },
      userId: 7,
    } as any;
    return { service, readiness, reviewService, context };
  };

  it('offers dismiss_review_finding', () => {
    const names = build('x')
      .service.getToolDefinitions()
      .map((tool: any) => tool.name);
    expect(names).toContain('dismiss_review_finding');
  });

  it('settles readiness as an edit after update_prd lands', async () => {
    const { service, readiness, context } = build('x');

    const outcome = await service.execute(
      'update_prd',
      { ops: [{ op: 'replace', path: '/summary', value: 'x' }] },
      context,
    );

    expect(readiness.settle).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ id: 'doc-2' }),
      'edit',
    );
    expect(outcome.modelResult).toEqual(
      expect.objectContaining({ ok: true, ready: true }),
    );
  });

  it("records a dismissal quoting the admin's latest message", async () => {
    const { service, reviewService, context } = build(
      'F2 is wrong — mobile ships in a separate release next month.',
    );

    const outcome = await service.execute(
      'dismiss_review_finding',
      {
        findingId: 'F2',
        adminQuote: 'mobile ships in a separate release next month',
      },
      context,
    );

    expect(outcome.modelResult.ok).toBe(true);
    expect(reviewService.dismiss).toHaveBeenCalledWith(
      context.doc,
      'F2',
      'mobile ships in a separate release next month',
      7,
      'interview',
    );
  });

  it('refuses a dismissal in words the admin did not write', async () => {
    const { service, reviewService, context } = build('Looks fine to me.');

    const outcome = await service.execute(
      'dismiss_review_finding',
      { findingId: 'F2', adminQuote: 'mobile is out of scope for now' },
      context,
    );

    expect(outcome.modelResult).toEqual(
      expect.objectContaining({ ok: false, error: 'not_the_admins_words' }),
    );
    expect(reviewService.dismiss).not.toHaveBeenCalled();
  });
});
