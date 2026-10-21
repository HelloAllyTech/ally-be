import { BadRequestException } from '@nestjs/common';
import { BuilderMessageRole } from '../../enum/builder.enum';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { createEmptyPrdDocument } from '../../type/builder-prd.type';
import {
  BuilderPrdReviewService,
  parseRecheck,
  parseReviewFindings,
  renderTranscriptForReview,
} from '../builder-prd-review.service';

describe('BuilderPrdReviewService', () => {
  describe('parseReviewFindings', () => {
    it('numbers valid findings and drops ones outside the five categories', () => {
      const findings = parseReviewFindings(
        JSON.stringify({
          findings: [
            {
              category: 'unapplied_correction',
              section: 'requirements',
              detail:
                'R3 still adds a challenger job; the admin said Auto-improve writes them.',
              fix: 'Replace R3 with reusing Auto-improve.',
              quote: 'Auto-improve already writes challengers',
            },
            { category: 'style', section: 'summary', detail: 'Too long.' },
            {
              category: 'missing_success_metric',
              section: 'not-a-key',
              detail: 'No target.',
            },
          ],
        }),
        8,
      );

      expect(findings).toEqual([
        expect.objectContaining({
          id: 'F1',
          category: 'unapplied_correction',
          section: 'requirements',
          status: 'open',
          raisedInVersion: 8,
        }),
        expect.objectContaining({
          id: 'F2',
          category: 'missing_success_metric',
          // An unknown section key is coerced rather than stored as-is.
          section: 'summary',
          fix: 'Correct the PRD.',
        }),
      ]);
    });

    it('reads a fenced answer and rejects one with no findings list', () => {
      expect(parseReviewFindings('```json\n{"findings":[]}\n```', 1)).toEqual(
        [],
      );
      expect(parseReviewFindings('The PRD looks fine.', 1)).toBeNull();
    });
  });

  describe('parseRecheck', () => {
    it('closes only on an explicit true', () => {
      const verdicts = parseRecheck(
        JSON.stringify({
          checks: [
            { id: 'F1', resolved: true, note: 'Mobile is planned now.' },
            { id: 'F2', resolved: 'probably', note: 'Partly.' },
          ],
        }),
      );

      expect(verdicts?.get('F1')?.resolved).toBe(true);
      expect(verdicts?.get('F2')?.resolved).toBe(false);
    });
  });

  describe('renderTranscriptForReview', () => {
    const messages = [
      {
        role: BuilderMessageRole.USER,
        content: 'Let learners rate the debrief.',
      },
      {
        role: BuilderMessageRole.ASSISTANT,
        content: 'I found the skill-experiment module.',
        toolResults: [
          {
            name: 'github_read_file',
            result: { ok: false, message: 'Not Found (404)' },
          },
        ],
      },
      ...Array.from({ length: 40 }, (_, index) => ({
        role: BuilderMessageRole.USER,
        content: `answer ${index} ${'x'.repeat(80)}`,
      })),
      { role: BuilderMessageRole.USER, content: 'Promotion already exists.' },
    ] as any[];

    it('marks failed tool calls', () => {
      expect(renderTranscriptForReview(messages, 100_000)).toContain(
        '[failed tool] github_read_file: Not Found (404)',
      );
    });

    it('keeps the opening request and the latest words within the budget', () => {
      const rendered = renderTranscriptForReview(messages, 1_000);

      expect(rendered.length).toBeLessThanOrEqual(1_200);
      expect(rendered.startsWith('ADMIN: Let learners rate the debrief.')).toBe(
        true,
      );
      expect(rendered).toContain('earlier line(s) left out');
      expect(rendered.endsWith('ADMIN: Promotion already exists.')).toBe(true);
    });
  });

  describe('review, recheck and dismiss', () => {
    let llmCompletion: { complete: jest.Mock };
    let docRepository: { update: jest.Mock; findOne: jest.Mock };
    let service: BuilderPrdReviewService;

    const doc = (overrides: Record<string, any> = {}) =>
      ({
        id: 'doc-1',
        versionNumber: 8,
        draft: createEmptyPrdDocument('Rate the debrief'),
        review: null,
        ...overrides,
      }) as any;
    const openReview = () => ({
      status: 'done',
      versionNumber: 8,
      checkedVersion: 8,
      model: 'gpt-5-mini',
      reviewedAt: 'then',
      checkedAt: 'then',
      findings: [
        {
          id: 'F1',
          category: 'contradiction',
          section: 'testPlanMd',
          detail: 'Tests ally-ai, which is not planned.',
          fix: 'Drop the ally-ai tests.',
          status: 'open',
          raisedInVersion: 8,
        },
        {
          id: 'F2',
          category: 'missing_success_metric',
          section: 'goals',
          detail: 'No metric.',
          fix: 'Name one.',
          status: 'open',
          raisedInVersion: 8,
        },
      ],
    });

    beforeEach(() => {
      llmCompletion = { complete: jest.fn() };
      docRepository = {
        update: jest.fn().mockResolvedValue(undefined),
        findOne: jest.fn().mockResolvedValue(null),
      };
      service = new BuilderPrdReviewService(
        llmCompletion as any,
        docRepository as any,
        { listBySession: jest.fn().mockResolvedValue([]) } as any,
        {
          renderForPrompt: jest
            .fn()
            .mockResolvedValue('- github_read_file: ally-be:src/a.ts'),
        } as any,
        {
          capabilities: () => [
            {
              name: 'Auto-improve',
              whatItIs: 'Challenger prompts judged against a rubric.',
              reuseWhen: 'A feature wants to test prompt versions.',
            },
          ],
        } as any,
      );
    });

    it('stores a review on the doc, on its own task with the PRD version', async () => {
      llmCompletion.complete.mockResolvedValue({
        text: JSON.stringify({
          findings: [
            {
              category: 'missing_success_metric',
              section: 'goals',
              detail: 'Nothing says how success is measured.',
              fix: 'Add the thumbs-up rate with a target.',
            },
          ],
        }),
        provider: 'openai',
        model: 'gpt-5-mini',
        stopReason: 'end_turn',
      });
      const target = doc();

      const review = await service.review('session-1', target);

      expect(llmCompletion.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'builder-prd-review',
          task: LlmTask.BUILDER_PRD_REVIEW,
          jsonMode: true,
          usageMetadata: expect.objectContaining({
            mode: 'review',
            prdVersion: 8,
          }),
        }),
      );
      expect(llmCompletion.complete.mock.calls[0][0].prompt).toContain(
        '<evidence_log>',
      );
      // The systems are facts for the reviewer, not the interviewer's
      // instructions — those read as requirements on the PRD.
      const prompt = llmCompletion.complete.mock.calls[0][0].prompt;
      expect(prompt).toContain(
        '- Auto-improve: Challenger prompts judged against a rubric. Reuse when: A feature wants to test prompt versions.',
      );
      expect(prompt).not.toContain('ai_tasks_lookup');
      expect(review).toEqual(
        expect.objectContaining({
          status: 'done',
          versionNumber: 8,
          model: 'gpt-5-mini',
          findings: [expect.objectContaining({ id: 'F1', status: 'open' })],
        }),
      );
      expect(docRepository.update).toHaveBeenCalledWith(
        { id: 'doc-1' },
        { review },
      );
      expect(target.review).toBe(review);
    });

    it('records a failed call as a failed review instead of throwing', async () => {
      llmCompletion.complete.mockRejectedValue(new Error('quota exhausted'));

      const first = await service.review('session-1', doc());
      const second = await service.review('session-1', doc({ review: first }));

      expect(first).toEqual(
        expect.objectContaining({
          status: 'failed',
          findings: [],
          failures: 1,
        }),
      );
      expect(second.failures).toBe(2);
    });

    it('treats a truncated answer as a failure, not as "no findings"', async () => {
      llmCompletion.complete.mockResolvedValue({
        text: '{"findings": [',
        model: 'gpt-5-mini',
        stopReason: 'max_tokens',
      });

      expect((await service.review('session-1', doc())).status).toBe('failed');
    });

    it('rechecks only the open findings and closes the resolved ones', async () => {
      llmCompletion.complete.mockResolvedValue({
        text: JSON.stringify({
          checks: [
            { id: 'F1', resolved: true, note: 'ally-ai tests removed.' },
            { id: 'F2', resolved: false, note: 'Still no metric.' },
            { id: 'F9', resolved: true, note: 'Invented.' },
          ],
        }),
        stopReason: 'end_turn',
      });

      const updated = await service.recheck(
        'session-1',
        doc({ versionNumber: 9, review: openReview() }),
      );

      expect(llmCompletion.complete.mock.calls[0][0].usageMetadata.mode).toBe(
        'recheck',
      );
      expect(updated?.checkedVersion).toBe(9);
      expect(updated?.findings).toEqual([
        expect.objectContaining({
          id: 'F1',
          status: 'fixed',
          fixedInVersion: 9,
        }),
        expect.objectContaining({
          id: 'F2',
          status: 'open',
          checkNote: 'Still no metric.',
        }),
      ]);
    });

    it('keeps a dismissal made while the recheck was running', async () => {
      llmCompletion.complete.mockResolvedValue({
        text: JSON.stringify({
          checks: [{ id: 'F2', resolved: false, note: 'Still no metric.' }],
        }),
        stopReason: 'end_turn',
      });
      const stored = openReview();
      stored.findings[1] = {
        ...stored.findings[1],
        status: 'dismissed',
        dismissal: {
          reason: 'Target set after launch.',
          by: 7,
          at: 'now',
          via: 'admin',
        },
      } as any;
      docRepository.findOne.mockResolvedValue({ id: 'doc-1', review: stored });

      const updated = await service.recheck(
        'session-1',
        doc({ versionNumber: 9, review: openReview() }),
      );

      expect(updated?.findings[1].status).toBe('dismissed');
    });

    it('does not recheck a PRD that has not changed since the last check', async () => {
      await service.recheck('session-1', doc({ review: openReview() }));

      expect(llmCompletion.complete).not.toHaveBeenCalled();
    });

    it('keeps findings open when the recheck call fails', async () => {
      llmCompletion.complete.mockRejectedValue(new Error('timeout'));
      const review = openReview();

      const result = await service.recheck(
        'session-1',
        doc({ versionNumber: 9, review }),
      );

      expect(result).toBe(review);
      expect(docRepository.update).not.toHaveBeenCalled();
    });

    it('dismisses a finding with who, how and why', async () => {
      const target = doc({ review: openReview() });

      const updated = await service.dismiss(
        target,
        'F2',
        'The admin sets the target after launch.',
        7,
        'admin',
      );

      expect(updated.findings[1]).toEqual(
        expect.objectContaining({
          status: 'dismissed',
          dismissal: expect.objectContaining({
            reason: 'The admin sets the target after launch.',
            by: 7,
            via: 'admin',
          }),
        }),
      );
      expect(updated.findings[0].status).toBe('open');
    });

    it('refuses a dismissal with no real reason, or of a closed finding', async () => {
      await expect(
        service.dismiss(
          doc({ review: openReview() }),
          'F1',
          'wrong',
          7,
          'admin',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      const closed = openReview();
      closed.findings[0].status = 'fixed';
      await expect(
        service.dismiss(
          doc({ review: closed }),
          'F1',
          'Not relevant any more.',
          7,
          'admin',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.dismiss(
          doc({ review: openReview() }),
          'F7',
          'Not relevant any more.',
          7,
          'admin',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
