import { TrackItem } from '../entity/track-item.entity';
import { QuizQuestion } from '../type/quiz.type';
import {
  ArticleContent,
  TrackItemType,
  VideoContent,
} from '../type/track.type';
import { QuizContent } from '../type/quiz.type';

/**
 * Every `QuizQuestion` an item carries, wherever it keeps them.
 *
 * Three component types hold questions in three different places — a quiz's
 * own list, an article's inline questions, a video's interjections — and
 * anything that works on questions as questions (per-language media
 * overrides, and whatever comes next) otherwise has to re-learn all three
 * shapes and will eventually miss one.
 *
 * Returns live references into `item.content`, so a caller may mutate them
 * in place; callers that must not affect the stored entity clone first, the
 * way `applyItemFields` does.
 */
export function questionsOf(item: TrackItem): QuizQuestion[] {
  const content = item.content;
  if (!content) return [];
  switch (item.type) {
    case TrackItemType.QUIZ:
      return (content as QuizContent).questions ?? [];
    case TrackItemType.ARTICLE:
      return (content as ArticleContent).questions ?? [];
    case TrackItemType.VIDEO:
      return ((content as VideoContent).interjections ?? [])
        .map((interjection) => interjection.question)
        .filter((question): question is QuizQuestion => !!question);
    default:
      return [];
  }
}

/** Only the questions that actually carry media, with their ids. */
export function questionsWithMedia(item: TrackItem): QuizQuestion[] {
  return questionsOf(item).filter((question) => !!question.media?.url);
}
