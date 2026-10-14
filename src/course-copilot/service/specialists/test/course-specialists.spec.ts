import { CourseMetaSpecialist } from '../course-meta.specialist';
import {
  COURSE_REVIEW_ACTION_TOOLS,
  CourseReviewSpecialist,
} from '../course-review.specialist';
import {
  IMAGE_PROMPT_GUARDRAILS,
  ImagePromptSpecialist,
} from '../image-prompt.specialist';
import { SpecialistValidationError } from '../specialist.types';
import { fakeLlm, makeBlueprint, makeBrief } from './specialist-test.fixtures';

const usageMetadata = { courseCopilotSessionId: 'session-1' };

describe('CourseMetaSpecialist', () => {
  const run = (response: Record<string, any>, template?: string) => {
    const llm = fakeLlm([response], template);
    const specialist = new CourseMetaSpecialist(llm.service);
    return {
      llm,
      result: specialist.generate({
        sessionId: 'session-1',
        brief: makeBrief(),
        blueprint: makeBlueprint(),
        usageMetadata,
      }),
    };
  };

  it('returns a trimmed title and two plain paragraphs', async () => {
    const { result, llm } = run({
      title: '"Staying With a Texter Who Wants to Leave."',
      description:
        'For new volunteers.\n\nYou will read, practise and reflect.',
    });
    await expect(result).resolves.toEqual({
      title: 'Staying With a Texter Who Wants to Leave',
      description:
        'For new volunteers.\n\nYou will read, practise and reflect.',
    });
    expect(llm.complete.mock.calls[0][0]).toMatchObject({
      promptCode: 'course_copilot_course_meta',
      taskId: 'course-copilot-meta',
      usageMetadata: {
        courseCopilotSessionId: 'session-1',
        specialist: 'course_meta',
      },
    });
  });

  it('caps the title at 80 characters on a word boundary', async () => {
    const long =
      'Listening ' +
      'carefully and kindly to people who text a helpline late at night '.repeat(
        3,
      );
    const { result } = run({ title: long, description: 'One.\n\nTwo.' });
    const { title } = await result;
    expect(title.length).toBeLessThanOrEqual(80);
    expect(long.startsWith(title)).toBe(true);
    expect(title.endsWith(' ')).toBe(false);
  });

  it('turns html or markdown into plain paragraphs and folds a third into the second', async () => {
    const { result } = run({
      title: 'T',
      description:
        '<p>For <strong>new</strong> volunteers.</p><p>Read and practise.</p><p>About an hour.</p>',
    });
    expect((await result).description).toBe(
      'For new volunteers.\n\nRead and practise. About an hour.',
    );
  });

  it('refuses an empty answer', async () => {
    const { result } = run({ title: '', description: '' });
    const error = await result.catch((caught) => caught);
    expect(error).toBeInstanceOf(SpecialistValidationError);
    expect(error.errors).toEqual([
      'The course needs a title.',
      'The course needs a description.',
    ]);
  });
});

describe('CourseReviewSpecialist', () => {
  const digest = 'Outline: item art-1 "Name the feeling", item qz-1 "Check"';
  const review = (response: Record<string, any>) => {
    const llm = fakeLlm([response]);
    return {
      llm,
      findings: new CourseReviewSpecialist(llm.service).review({
        sessionId: 'session-1',
        brief: makeBrief(),
        courseDigest: digest,
        usageMetadata,
      }),
    };
  };

  it('keeps findings, drops unknown tools and invented ids, and sorts fixes first', async () => {
    const { findings, llm } = review({
      findings: [
        { severity: 'consider', note: 'Shorten the article.', itemId: 'art-1' },
        {
          severity: 'high',
          note: 'Quiz key contradicts the article.',
          itemId: 'qz-1',
          suggestedAction: {
            tool: 'regenerate_item',
            input: { itemId: 'qz-1', instructions: 'Flip Q3.' },
          },
        },
        {
          severity: 'fix',
          note: 'Publish it now.',
          itemId: 'made-up-id',
          suggestedAction: { tool: 'publish_course', input: {} },
        },
        { severity: 'fix', note: '' },
      ],
    });
    await expect(findings).resolves.toEqual([
      {
        severity: 'fix',
        note: 'Quiz key contradicts the article.',
        itemId: 'qz-1',
        suggestedAction: {
          tool: 'regenerate_item',
          input: { itemId: 'qz-1', instructions: 'Flip Q3.' },
        },
      },
      { severity: 'fix', note: 'Publish it now.' },
      { severity: 'consider', note: 'Shorten the article.', itemId: 'art-1' },
    ]);
    expect(llm.complete.mock.calls[0][0].promptCode).toBe(
      'course_copilot_course_reviewer',
    );
  });

  it('returns at most ten findings and accepts a clean course', async () => {
    const many = Array.from({ length: 14 }, (_, index) => ({
      severity: 'consider',
      note: `Note ${index}`,
    }));
    await expect(review({ findings: many }).findings).resolves.toHaveLength(10);
    await expect(review({ findings: [] }).findings).resolves.toEqual([]);
  });

  it('lists exactly the edit tools the lead registered', () => {
    expect([...COURSE_REVIEW_ACTION_TOOLS]).toEqual([
      'regenerate_item',
      'update_item_content',
      'set_completion_rule',
      'update_course_meta',
      'add_item',
      'remove_item',
      'move_item',
    ]);
  });
});

describe('ImagePromptSpecialist', () => {
  it('appends the guardrails to whatever the model wrote', async () => {
    const llm = fakeLlm(
      [
        {
          prompt:
            '  A helpline desk at dusk,   a headset resting on a notebook  ',
        },
      ],
      'For {{image_purpose}} titled {{image_title}}: {{image_context}}',
    );
    const prompt = await new ImagePromptSpecialist(llm.service).write({
      sessionId: 'session-1',
      brief: makeBrief(),
      purpose: 'cover',
      title: 'Staying with the texter',
      context: 'A course for new volunteers.',
      usageMetadata,
    });
    expect(prompt).toBe(
      `A helpline desk at dusk, a headset resting on a notebook. ${IMAGE_PROMPT_GUARDRAILS}`,
    );
    expect(llm.promptOf(0)).toContain('the cover image for the whole course');
    expect(llm.promptOf(0)).toContain('titled Staying with the texter');
  });

  it('fails on an empty prompt', async () => {
    const llm = fakeLlm([{ prompt: '' }]);
    await expect(
      new ImagePromptSpecialist(llm.service).write({
        sessionId: 's',
        brief: makeBrief(),
        purpose: 'article',
        title: 'T',
        context: 'C',
        usageMetadata,
      }),
    ).rejects.toBeInstanceOf(SpecialistValidationError);
  });
});
