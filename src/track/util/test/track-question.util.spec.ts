import { questionsOf, questionsWithMedia } from '../track-question.util';
import { TrackItem } from '../../entity/track-item.entity';
import { TrackItemType } from '../../type/track.type';
import { QuizQuestionType } from '../../type/quiz.type';

const media = {
  kind: 'image' as const,
  source: 's3' as const,
  url: 'https://bucket.s3.ap-south-1.amazonaws.com/track-media/question_image/1-x.png',
};

const question = (id: string, withMedia = false) =>
  ({
    id,
    type: QuizQuestionType.MCQ_SINGLE,
    prompt: `Q ${id}`,
    options: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    correctOptionIds: ['a'],
    ...(withMedia ? { media } : {}),
  }) as any;

const item = (type: TrackItemType, content: unknown): TrackItem =>
  ({ id: 'item-1', type, content }) as TrackItem;

describe('questionsOf', () => {
  it("finds a quiz's own questions", () => {
    const result = questionsOf(
      item(TrackItemType.QUIZ, {
        settings: { passScore: 70 },
        questions: [question('q1'), question('q2')],
      }),
    );
    expect(result.map((q) => q.id)).toEqual(['q1', 'q2']);
  });

  it("finds an article's inline questions", () => {
    const result = questionsOf(
      item(TrackItemType.ARTICLE, {
        html: '<p>hi</p>',
        questions: [question('a1')],
      }),
    );
    expect(result.map((q) => q.id)).toEqual(['a1']);
  });

  // The whole point of this helper: a video keeps its questions one level
  // deeper than the other two, and code that forgets that silently skips
  // every interjection.
  it("finds a video's interjection questions", () => {
    const result = questionsOf(
      item(TrackItemType.VIDEO, {
        source: 's3',
        url: 'https://x/y.mp4',
        interjections: [
          { id: 'i1', timestampSeconds: 10, question: question('v1') },
          { id: 'i2', timestampSeconds: 20, question: question('v2') },
        ],
      }),
    );
    expect(result.map((q) => q.id)).toEqual(['v1', 'v2']);
  });

  it('skips an interjection with no question rather than emitting undefined', () => {
    const result = questionsOf(
      item(TrackItemType.VIDEO, {
        source: 's3',
        url: 'https://x/y.mp4',
        interjections: [{ id: 'i1', timestampSeconds: 10 }],
      }),
    );
    expect(result).toEqual([]);
  });

  it.each([
    [TrackItemType.JOURNAL, { prompts: [] }],
    [TrackItemType.ROLEPLAY, null],
    [TrackItemType.QUIZ, null],
  ])('returns nothing for %s with no questions', (type, content) => {
    expect(questionsOf(item(type as TrackItemType, content))).toEqual([]);
  });

  it('returns live references, so a caller can rewrite media in place', () => {
    const target = item(TrackItemType.QUIZ, {
      settings: { passScore: 70 },
      questions: [question('q1', true)],
    });
    questionsOf(target)[0].media!.url = 'https://elsewhere/x.png';
    expect((target.content as any).questions[0].media.url).toBe(
      'https://elsewhere/x.png',
    );
  });
});

describe('questionsWithMedia', () => {
  it('returns only the questions that carry media', () => {
    const result = questionsWithMedia(
      item(TrackItemType.QUIZ, {
        settings: { passScore: 70 },
        questions: [question('q1'), question('q2', true), question('q3')],
      }),
    );
    expect(result.map((q) => q.id)).toEqual(['q2']);
  });
});
