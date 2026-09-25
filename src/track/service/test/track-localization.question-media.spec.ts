import { TrackLocalizationService } from '../track-localization.service';
import { TrackItem } from '../../entity/track-item.entity';
import { TrackTranslation } from '../../entity/track-translation.entity';
import { TrackItemType } from '../../type/track.type';
import { QuizQuestionType } from '../../type/quiz.type';
import { mediaOverrideKey } from '../../type/track-translation.type';

const ITEM_ID = 'item-1';
const ENGLISH_DIAGRAM =
  'https://bucket.s3.ap-south-1.amazonaws.com/track-media/question_image/1-en-diagram.png';
const HINDI_DIAGRAM =
  'https://bucket.s3.ap-south-1.amazonaws.com/track-media/question_image/2-hi-diagram.png';
const ENGLISH_CLIP =
  'https://bucket.s3.ap-south-1.amazonaws.com/track-media/question_video/1-en.mp4';

const quizItem = (): TrackItem =>
  ({
    id: ITEM_ID,
    type: TrackItemType.QUIZ,
    title: 'Observation check',
    content: {
      settings: { passScore: 70 },
      questions: [
        {
          id: 'q-diagram',
          type: QuizQuestionType.MCQ_SINGLE,
          prompt: 'Which step is missing?',
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
          correctOptionIds: ['a'],
          media: {
            kind: 'image',
            source: 's3',
            url: ENGLISH_DIAGRAM,
            alt: 'A labelled handwashing diagram',
          },
        },
        {
          id: 'q-photo',
          type: QuizQuestionType.MCQ_SINGLE,
          prompt: 'What do you notice?',
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
          correctOptionIds: ['a'],
          media: {
            kind: 'video',
            source: 's3',
            url: ENGLISH_CLIP,
            posterUrl: 'https://bucket.s3.ap-south-1.amazonaws.com/p.jpg',
          },
        },
      ],
    },
  }) as unknown as TrackItem;

const translation = (
  media: Record<string, { url?: string }>,
): TrackTranslation =>
  ({
    content: { track: {}, sections: {}, items: {}, media },
  }) as unknown as TrackTranslation;

describe('TrackLocalizationService.localizeItem — question media', () => {
  let service: TrackLocalizationService;

  beforeEach(() => {
    // localizeItem is pure over (item, translation) — none of the injected
    // collaborators are reached on this path.
    service = new TrackLocalizationService({} as any, {} as any, {} as any);
  });

  const questionsOfResult = (item: TrackItem) =>
    (item.content as any).questions as any[];

  it('swaps in the localised diagram for the question that has one', () => {
    const localized = service.localizeItem(
      quizItem(),
      translation({
        [mediaOverrideKey(ITEM_ID, 'q-diagram')]: { url: HINDI_DIAGRAM },
      }),
    );
    expect(questionsOfResult(localized)[0].media.url).toBe(HINDI_DIAGRAM);
  });

  /**
   * The case this feature exists to get right: a photograph carries no
   * language, so an untranslated one is the correct answer rather than a
   * gap to fill.
   */
  it('leaves a question with no override on the English original', () => {
    const localized = service.localizeItem(
      quizItem(),
      translation({
        [mediaOverrideKey(ITEM_ID, 'q-diagram')]: { url: HINDI_DIAGRAM },
      }),
    );
    expect(questionsOfResult(localized)[1].media.url).toBe(ENGLISH_CLIP);
  });

  it('drops the English poster when the clip itself is replaced', () => {
    const localized = service.localizeItem(
      quizItem(),
      translation({
        [mediaOverrideKey(ITEM_ID, 'q-photo')]: { url: 'https://x/hi.mp4' },
      }),
    );
    expect(questionsOfResult(localized)[1].media.url).toBe('https://x/hi.mp4');
    expect(questionsOfResult(localized)[1].media.posterUrl).toBeUndefined();
  });

  it('keeps the poster when the clip is not overridden', () => {
    const localized = service.localizeItem(quizItem(), translation({}));
    expect(questionsOfResult(localized)[1].media.posterUrl).toBe(
      'https://bucket.s3.ap-south-1.amazonaws.com/p.jpg',
    );
  });

  // localizeItem hands the learner a copy; writing an override onto the
  // stored entity would leak one language's media into every other.
  it('never mutates the stored item', () => {
    const source = quizItem();
    service.localizeItem(
      source,
      translation({
        [mediaOverrideKey(ITEM_ID, 'q-diagram')]: { url: HINDI_DIAGRAM },
      }),
    );
    expect(questionsOfResult(source)[0].media.url).toBe(ENGLISH_DIAGRAM);
  });

  it('ignores an override pointing at a question that no longer exists', () => {
    const localized = service.localizeItem(
      quizItem(),
      translation({
        [mediaOverrideKey(ITEM_ID, 'q-deleted')]: { url: HINDI_DIAGRAM },
      }),
    );
    expect(questionsOfResult(localized)[0].media.url).toBe(ENGLISH_DIAGRAM);
  });

  it('returns the item untouched when the course has no translation', () => {
    const localized = service.localizeItem(quizItem(), null);
    expect(questionsOfResult(localized)[0].media.url).toBe(ENGLISH_DIAGRAM);
  });
});
