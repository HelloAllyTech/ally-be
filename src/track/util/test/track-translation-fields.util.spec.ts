import {
  applyItemFields,
  diffFields,
  extractItemFields,
  hashSource,
  toTranslatedField,
} from '../track-translation-fields.util';
import { TrackItem } from '../../entity/track-item.entity';
import { TrackItemType } from '../../type/track.type';
import { QuizQuestionType } from '../../type/quiz.type';
import {
  AnnotationArtifactKind,
  AnnotationRevealKey,
  AnnotationSwatch,
} from '../../type/annotation.type';
import {
  TranslatableFieldKind,
  TranslatedFieldMap,
} from '../../type/track-translation.type';

const item = (overrides: Partial<TrackItem>): TrackItem =>
  ({
    id: 'item-1',
    trackId: 'track-1',
    trackSectionId: 'section-1',
    order: 1,
    title: 'Spotting risk',
    ...overrides,
  }) as TrackItem;

/** Machine-translates every extracted field by prefixing it, the cheap stand-in
 *  for a model round trip. */
const translateAll = (target: TrackItem): TranslatedFieldMap => {
  const map: TranslatedFieldMap = {};
  for (const field of extractItemFields(target)) {
    map[field.path] = toTranslatedField(field, `hi:${field.value}`);
  }
  return map;
};

describe('extractItemFields', () => {
  it('extracts the heading of every component type', () => {
    const paths = extractItemFields(
      item({
        type: TrackItemType.VIDEO,
        description: 'Watch this',
        content: { source: 's3', url: 'https://x/y.mp4' } as any,
      }),
    ).map((field) => field.path);

    // A video's URL is not text — only its heading is translatable.
    expect(paths).toEqual(['title', 'description']);
  });

  it('keys quiz fields by question and option id, not array position', () => {
    const paths = extractItemFields(
      item({
        type: TrackItemType.QUIZ,
        content: {
          settings: { passScore: 70 },
          questions: [
            {
              id: 'q1',
              type: QuizQuestionType.MCQ_SINGLE,
              prompt: 'What do you do first?',
              explanation: 'Because safety comes first.',
              options: [
                { id: 'o1', text: 'Ask about safety' },
                { id: 'o2', text: 'Offer advice' },
              ],
              correctOptionIds: ['o1'],
            },
          ],
        } as any,
      }),
    ).map((field) => field.path);

    expect(paths).toEqual([
      'title',
      'content.questions[q1].prompt',
      'content.questions[q1].explanation',
      'content.questions[q1].options[o1].text',
      'content.questions[q1].options[o2].text',
    ]);
  });

  it('never emits answer keys or ids as translatable fields', () => {
    const fields = extractItemFields(
      item({
        type: TrackItemType.QUIZ,
        content: {
          settings: { passScore: 70 },
          questions: [
            {
              id: 'q1',
              type: QuizQuestionType.MATCHING,
              prompt: 'Match the cue to the response',
              left: [{ id: 'l1', text: 'Silence' }],
              right: [{ id: 'r1', text: 'Wait' }],
              correctPairs: [{ leftId: 'l1', rightId: 'r1' }],
            },
          ],
        } as any,
      }),
    );

    const joined = fields.map((field) => field.path).join(' ');
    expect(joined).not.toContain('correctPairs');
    expect(joined).not.toContain('.id');
    expect(fields.map((f) => f.path)).toEqual([
      'title',
      'content.questions[q1].prompt',
      'content.questions[q1].left[l1].text',
      'content.questions[q1].right[r1].text',
    ]);
  });

  it('flags scoring-critical quiz fields', () => {
    const fields = extractItemFields(
      item({
        type: TrackItemType.QUIZ,
        content: {
          settings: { passScore: 70 },
          questions: [
            {
              id: 'q1',
              type: QuizQuestionType.FILL_BLANK,
              prompt: 'Complete the reflection',
              template: 'You sound {{b1}} right now.',
              blanks: [
                { id: 'b1', acceptedAnswers: ['overwhelmed', 'stressed'] },
              ],
            },
            {
              id: 'q2',
              type: QuizQuestionType.OPEN_ENDED,
              prompt: 'How would you open the call?',
              rubric: { guidance: 'Look for a safety check.', maxScore: 10 },
            },
          ],
        } as any,
      }),
    );

    const scoring = fields
      .filter((field) => field.scoring)
      .map((field) => field.path);
    expect(scoring).toEqual([
      'content.questions[q1].template',
      'content.questions[q1].blanks[b1].acceptedAnswers[0]',
      'content.questions[q1].blanks[b1].acceptedAnswers[1]',
      'content.questions[q2].rubric.guidance',
    ]);

    // The prompt a learner reads is not a marking key.
    expect(
      fields.find((f) => f.path === 'content.questions[q1].prompt')?.scoring,
    ).toBe(false);
  });

  it('marks annotation labels as scoring but transcript units as prose', () => {
    const fields = extractItemFields(
      item({
        type: TrackItemType.ANNOTATED_ARTIFACT,
        content: {
          kind: AnnotationArtifactKind.TRANSCRIPT,
          intro: 'Where does the caller minimise?',
          units: [
            { id: 'u1', speaker: 'Caller', text: "It's not a big deal." },
          ],
          labels: [
            {
              id: 'l1',
              text: 'Minimising',
              description: 'Playing down the seriousness',
              color: AnnotationSwatch.AMBER,
            },
          ],
          targets: [
            { unitId: 'u1', labelId: 'l1', note: 'Classic deflection.' },
          ],
          settings: {
            passScore: 70,
            falsePositivePenalty: 1,
            revealKey: AnnotationRevealKey.AFTER_PASS_OR_LAST_ATTEMPT,
          },
        } as any,
      }),
    );

    const byPath = new Map(fields.map((field) => [field.path, field]));
    // The label set is the vocabulary the learner picks from.
    expect(byPath.get('content.labels[l1].text')?.scoring).toBe(true);
    // Grading compares (unitId, labelId) sets, so unit text cannot relabel the key.
    expect(byPath.get('content.units[u1].text')?.scoring).toBe(false);
    expect(byPath.get('content.units[u1].text')?.kind).toBe(
      TranslatableFieldKind.PROSE,
    );
    // Targets are keyed by the (unit, label) pair, not by array position. The
    // `:` is part of the persisted jsonb key format, so it is asserted rather
    // than borrowed from annotation.type's markKey, whose separator is an
    // in-memory detail free to change.
    expect(byPath.has('content.targets[u1:l1].note')).toBe(true);
    // No path may carry a NUL byte — Postgres rejects those inside jsonb.
    expect([...byPath.keys()].some((path) => path.includes('\0'))).toBe(false);
  });

  it('does not mutate the item it reads', () => {
    const source = item({
      type: TrackItemType.ARTICLE,
      content: { html: '<p>Read this</p>' } as any,
    });
    const before = JSON.stringify(source);
    extractItemFields(source);
    expect(JSON.stringify(source)).toBe(before);
  });
});

describe('applyItemFields', () => {
  it('replaces every extracted string and leaves ids and answer keys alone', () => {
    const source = item({
      type: TrackItemType.QUIZ,
      content: {
        settings: { passScore: 70 },
        questions: [
          {
            id: 'q1',
            type: QuizQuestionType.MCQ_SINGLE,
            prompt: 'What do you do first?',
            options: [
              { id: 'o1', text: 'Ask about safety' },
              { id: 'o2', text: 'Offer advice' },
            ],
            correctOptionIds: ['o1'],
          },
        ],
      } as any,
    });

    const localized = applyItemFields(source, translateAll(source));
    const question = (localized.content as any).questions[0];

    expect(localized.title).toBe('hi:Spotting risk');
    expect(question.prompt).toBe('hi:What do you do first?');
    expect(question.options.map((o: any) => o.text)).toEqual([
      'hi:Ask about safety',
      'hi:Offer advice',
    ]);
    // Structure is untouched — this is what makes grading still work.
    expect(question.id).toBe('q1');
    expect(question.options.map((o: any) => o.id)).toEqual(['o1', 'o2']);
    expect(question.correctOptionIds).toEqual(['o1']);
  });

  it('translates the accepted answers a fill-blank is marked against', () => {
    const source = item({
      type: TrackItemType.QUIZ,
      content: {
        settings: { passScore: 70 },
        questions: [
          {
            id: 'q1',
            type: QuizQuestionType.FILL_BLANK,
            prompt: 'Complete it',
            template: 'You sound {{b1}}.',
            blanks: [{ id: 'b1', acceptedAnswers: ['overwhelmed'] }],
          },
        ],
      } as any,
    });

    const localized = applyItemFields(source, translateAll(source));
    const blank = (localized.content as any).questions[0].blanks[0];

    // A learner shown Hindi types Hindi, so the marking key must be Hindi too.
    expect(blank.acceptedAnswers).toEqual(['hi:overwhelmed']);
    expect(blank.id).toBe('b1');
  });

  it('does not mutate the source item', () => {
    const source = item({
      type: TrackItemType.ARTICLE,
      content: { html: '<p>Read this</p>' } as any,
    });
    const fields = translateAll(source);

    const localized = applyItemFields(source, fields);
    expect((localized.content as any).html).toBe('hi:<p>Read this</p>');
    expect((source.content as any).html).toBe('<p>Read this</p>');
    expect(source.title).toBe('Spotting risk');
  });

  it('falls back to English for a field whose source has since changed', () => {
    const source = item({
      type: TrackItemType.ARTICLE,
      content: { html: '<p>Read this</p>' } as any,
    });
    const fields = translateAll(source);

    // The trainer reworded the English; the stored hash no longer matches.
    const edited = item({
      ...source,
      title: 'Spotting risk cues',
      content: { html: '<p>Read this</p>' } as any,
    });

    const localized = applyItemFields(edited, fields);
    expect(localized.title).toBe('Spotting risk cues');
    // Untouched fields still read in the translation.
    expect((localized.content as any).html).toBe('hi:<p>Read this</p>');
  });

  it('leaves a field English when there is no translation for it', () => {
    const source = item({
      type: TrackItemType.JOURNAL,
      content: {
        prompts: [{ id: 'p1', prompt: 'What surprised you?' }],
      } as any,
    });

    const localized = applyItemFields(source, {
      title: toTranslatedField(
        {
          path: 'title',
          value: 'Spotting risk',
          kind: TranslatableFieldKind.TITLE,
        },
        'hi:Spotting risk',
      ),
    });

    expect(localized.title).toBe('hi:Spotting risk');
    expect((localized.content as any).prompts[0].prompt).toBe(
      'What surprised you?',
    );
  });
});

describe('diffFields', () => {
  const live = [
    {
      path: 'title',
      value: 'Spotting risk',
      kind: TranslatableFieldKind.TITLE,
      scoring: false,
    },
    {
      path: 'description',
      value: 'A short module',
      kind: TranslatableFieldKind.DESCRIPTION,
      scoring: false,
    },
  ];

  it('queues fields that have never been translated', () => {
    const diff = diffFields(live, {});
    expect(diff.toTranslate.map((f) => f.path)).toEqual([
      'title',
      'description',
    ]);
    expect(diff.sourceChanged).toEqual([]);
  });

  it('skips fields whose English is unchanged', () => {
    const stored: TranslatedFieldMap = {
      title: { value: 'x', sourceHash: hashSource('Spotting risk') },
      description: { value: 'y', sourceHash: hashSource('A short module') },
    };
    expect(diffFields(live, stored).toTranslate).toEqual([]);
  });

  it('re-translates a changed field the trainer never edited', () => {
    const stored: TranslatedFieldMap = {
      title: { value: 'x', sourceHash: hashSource('Something older') },
    };
    const diff = diffFields(live, stored);
    expect(diff.toTranslate.map((f) => f.path)).toEqual([
      'title',
      'description',
    ]);
    expect(diff.sourceChanged).toEqual([]);
  });

  it('never re-translates a hand-edited field, but flags its source moved', () => {
    const stored: TranslatedFieldMap = {
      title: {
        value: 'trainer wording',
        sourceHash: hashSource('Something older'),
        edited: true,
      },
      description: { value: 'y', sourceHash: hashSource('A short module') },
    };
    const diff = diffFields(live, stored);

    expect(diff.toTranslate).toEqual([]);
    expect(diff.sourceChanged.map((f) => f.path)).toEqual(['title']);
  });

  it('reports translations of strings no longer in the course', () => {
    const stored: TranslatedFieldMap = {
      title: { value: 'x', sourceHash: hashSource('Spotting risk') },
      description: { value: 'y', sourceHash: hashSource('A short module') },
      'content.questions[gone].prompt': { value: 'z', sourceHash: 'abc' },
    };
    expect(diffFields(live, stored).orphaned).toEqual([
      'content.questions[gone].prompt',
    ]);
  });
});

describe('hashSource', () => {
  it('ignores surrounding whitespace so a reformat is not a source change', () => {
    expect(hashSource('  Spotting risk\n')).toBe(hashSource('Spotting risk'));
  });

  it('distinguishes different text', () => {
    expect(hashSource('Spotting risk')).not.toBe(hashSource('Spotting risks'));
  });
});
