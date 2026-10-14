import { validateTrackItemContent } from 'src/track/service/track-structure.validator';
import {
  parseArticleQuestionMarkers,
  TrackItemType,
} from 'src/track/type/track.type';
import { ArticleSpecialist } from '../article.specialist';
import { SpecialistValidationError } from '../specialist.types';
import {
  collectIds,
  expectAllUuids,
  fakeLlm,
  makeBlueprint,
  makeBrief,
  makeContext,
  words,
} from './specialist-test.fixtures';

const mcq = (
  id: string,
  correct: unknown = ['b'],
  extra: Record<string, any> = {},
) => ({
  id,
  type: 'mcq_single',
  prompt: `Check ${id}?`,
  options: [
    { id: 'a', text: 'Give advice' },
    { id: 'b', text: 'Reflect the feeling' },
    { id: 'c', text: 'Change the subject' },
  ],
  correctOptionIds: correct,
  explanation: 'Reflecting first shows you heard them.',
  ...extra,
});

/** Fenced, duplicate ids, a nested marker, an orphan marker, unsafe html. */
const MESSY_ARTICLE =
  '```json\n' +
  JSON.stringify({
    html:
      `<h1>Title the model should not add</h1><p style="color:red">${words(200)}</p>` +
      `<p>${words(60)} <div data-ally-question="q1"></div> more text</p>` +
      '<script>alert(1)</script><img src="https://evil.example/x.png">' +
      `<p>Read <a href="javascript:alert(1)">this</a> and ${words(60)}</p>` +
      '<div data-ally-question="q1"></div>' +
      '<div data-ally-question="ghost"></div>' +
      `<h4>Small heading</h4><p>${words(80)}</p>`,
    questions: [mcq('q1'), mcq('q1', 'Reflect the feeling')],
    resources: [
      { id: 'r1', title: 'Invented', url: 'https://made-up.example/guide' },
      {
        id: 'r1',
        title: 'Listening guide',
        url: 'https://example.org/listening-guide',
      },
      { id: 'r3', title: 'Bad scheme', url: 'ftp://example.org/x' },
    ],
    imageBrief: 'A volunteer at a desk at night, seen from behind.',
  }) +
  '\n```';

describe('ArticleSpecialist', () => {
  it('normalises messy output into valid ARTICLE content with fresh, consistent ids', async () => {
    const llm = fakeLlm([MESSY_ARTICLE]);
    const output = await new ArticleSpecialist(llm.service).generate(
      makeContext('art-1'),
    );
    const content = output.content as any;

    expect(() =>
      validateTrackItemContent({
        type: TrackItemType.ARTICLE,
        content,
        title: 'A',
      }),
    ).not.toThrow();

    expect(content.questions).toHaveLength(2);
    expectAllUuids(collectIds(content));
    for (const question of content.questions) {
      const optionIds = question.options.map((option: any) => option.id);
      expect(optionIds).toContain(question.correctOptionIds[0]);
      expect(question.options[1].id).toBe(question.correctOptionIds[0]);
    }

    // Each question anchored exactly once, at top level, and the orphan gone.
    const markers = parseArticleQuestionMarkers(content.html);
    expect(markers.sort()).toEqual(
      content.questions.map((q: any) => q.id).sort(),
    );
    // No placeholder between an opening <p> and its closing tag.
    expect(content.html).not.toMatch(/<p>(?:(?!<\/p>)[^])*data-ally-question/);
    expect(content.html).not.toContain('ghost');

    // Sanitised: no script, no generated image, no styles, no javascript links.
    expect(content.html).not.toMatch(
      /<script|<img|style=|javascript:|<h1|<h4/i,
    );
    expect(content.html).toContain('<h2>Title the model should not add</h2>');
    expect(content.html).toContain('<h3>Small heading</h3>');
    expect(content.imageUrls).toBeUndefined();

    // Only the link the trainer supplied survives.
    expect(content.resources).toEqual([
      {
        id: expect.any(String),
        title: 'Listening guide',
        url: 'https://example.org/listening-guide',
      },
    ]);

    expect(output.summary).toMatch(/^\d+ words · 2 checks$/);
    // articleImages is 'none' and the spec does not ask for one.
    expect(output.imageBrief).toBeUndefined();
  });

  it('passes the session usage metadata and the article prompt code', async () => {
    const llm = fakeLlm([{ html: `<p>${words(300)}</p>`, questions: [] }]);
    await new ArticleSpecialist(llm.service).generate(
      makeContext('art-1', {}, withSpec({ questionCount: 0 })),
    );
    expect(llm.complete.mock.calls[0][0]).toMatchObject({
      promptCode: 'course_copilot_article_writer',
      taskId: 'course-copilot-article',
      usageMetadata: {
        courseCopilotSessionId: 'session-1',
        jobId: 'job-1',
        specialist: 'article',
      },
    });
  });

  it('returns an image brief when the article asks for an image', async () => {
    const llm = fakeLlm([
      {
        html: `<p>${words(300)}</p>`,
        imageBrief: 'Two mugs on a kitchen table.',
      },
    ]);
    const output = await new ArticleSpecialist(llm.service).generate(
      makeContext('art-1', {}, withSpec({ withImage: true, questionCount: 0 })),
    );
    expect(output.imageBrief).toBe('Two mugs on a kitchen table.');
    expect(output.summary).toMatch(/^\d+ words$/);
  });

  it('follows the brief image policy when the spec is silent', async () => {
    const llm = fakeLlm([{ html: `<p>${words(300)}</p>`, imageBrief: null }]);
    const context = makeContext('art-1', {
      brief: makeBrief({
        look: { cover: 'generate', articleImages: 'one-per-article' },
      }),
    });
    const output = await new ArticleSpecialist(llm.service).generate(context);
    // The model forgot it; the item purpose stands in.
    expect(output.imageBrief).toBe('Purpose line');
  });

  it('anchors a question the model never placed at the end', async () => {
    const llm = fakeLlm([
      { html: `<p>${words(300)}</p>`, questions: [mcq('q9')] },
    ]);
    const output = await new ArticleSpecialist(llm.service).generate(
      makeContext('art-1'),
    );
    const content = output.content as any;
    expect(
      content.html.endsWith(
        `<div data-ally-question="${content.questions[0].id}"></div>`,
      ),
    ).toBe(true);
  });

  it('drops questions and placeholders when the spec asks for none', async () => {
    const llm = fakeLlm([
      {
        html: `<p>${words(300)}</p><div data-ally-question="q1"></div>`,
        questions: [mcq('q1')],
      },
    ]);
    const output = await new ArticleSpecialist(llm.service).generate(
      makeContext('art-1', {}, withSpec({ questionCount: 0 })),
    );
    expect((output.content as any).questions).toBeUndefined();
    expect((output.content as any).html).not.toContain('data-ally-question');
  });

  it('fails a question with no single correct option, and drops it on the repair pass', async () => {
    const broken = {
      html: `<p>${words(300)}</p>`,
      questions: [mcq('q1', ['a', 'b']), mcq('q2')],
    };

    const strict = fakeLlm([broken]);
    const error = await new ArticleSpecialist(strict.service)
      .generate(makeContext('art-1'))
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(SpecialistValidationError);
    expect(error.errors[0]).toMatch(
      /Inline question 1 .* exactly one correct option/,
    );

    const repair = fakeLlm([broken]);
    const output = await new ArticleSpecialist(repair.service).generate(
      makeContext('art-1', { repairErrors: error.errors }),
    );
    expect((output.content as any).questions).toHaveLength(1);
    expect(repair.promptOf(0)).toContain(
      'Your previous output was rejected for these reasons:',
    );
    expect(repair.promptOf(0)).toContain(error.errors[0]);
  });

  it('rejects a stub article', async () => {
    const llm = fakeLlm([{ html: '<p>Too short.</p>' }]);
    await expect(
      new ArticleSpecialist(llm.service).generate(makeContext('art-1')),
    ).rejects.toBeInstanceOf(SpecialistValidationError);
  });

  it('rejects an empty body', async () => {
    const llm = fakeLlm([{ html: '' }]);
    const error = await new ArticleSpecialist(llm.service)
      .generate(makeContext('art-1'))
      .catch((caught) => caught);
    expect(error.errors).toEqual([
      'The article has no body — "html" was empty.',
    ]);
  });

  it('keeps existing ids and the illustration on a regeneration', async () => {
    const questionId = '7f9c0c0e-8d47-4d7e-9a43-6f1f3d9b1a01';
    const optionIds = [
      '1b8b3c8e-1d0e-4e6f-8a3b-2a6b4c1d2e01',
      '1b8b3c8e-1d0e-4e6f-8a3b-2a6b4c1d2e02',
    ];
    const imageSrc = 'https://cdn.example.com/track-media/image/a.png';
    const previousContent = {
      html: `<p><img src="${imageSrc}" alt="A desk"></p><p>${words(300)}</p><div data-ally-question="${questionId}"></div>`,
      imageUrls: [imageSrc],
      questions: [
        {
          id: questionId,
          type: 'mcq_single',
          prompt: 'Old?',
          options: [
            { id: optionIds[0], text: 'One' },
            { id: optionIds[1], text: 'Two' },
          ],
          correctOptionIds: [optionIds[1]],
        },
      ],
    };
    // The model echoes the ids but drops the image.
    const llm = fakeLlm([
      {
        html: `<p>${words(320)}</p><div data-ally-question="${questionId}"></div>`,
        questions: [
          {
            id: questionId,
            type: 'mcq_single',
            prompt: 'Sharper?',
            options: [
              { id: optionIds[0], text: 'One' },
              { id: optionIds[1], text: 'Two' },
            ],
            correctOptionIds: [optionIds[1]],
            explanation: 'Because.',
          },
        ],
      },
    ]);
    const output = await new ArticleSpecialist(llm.service).generate(
      makeContext('art-1', {
        previous: {
          content: previousContent,
          instructions: 'Tighten the question.',
        },
      }),
    );
    const content = output.content as any;
    expect(content.questions[0].id).toBe(questionId);
    expect(content.questions[0].correctOptionIds).toEqual([optionIds[1]]);
    expect(content.html).toContain(`<img src="${imageSrc}"`);
    expect(content.imageUrls).toEqual([imageSrc]);
    expect(llm.promptOf(0)).toContain(
      'The trainer asked for this change: Tighten the question.',
    );
  });
});

function withSpec(spec: Record<string, any>) {
  const blueprint = makeBlueprint();
  blueprint.sections[0].items[0].spec = spec;
  return blueprint;
}
