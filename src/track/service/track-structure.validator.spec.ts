import { computeStructuralSignature } from './track-structure.validator';
import { UpsertTrackSectionDto } from '../dto/upsert-track-structure.dto';
import { TrackItemType, VideoContent, VideoSource } from '../type/track.type';
import { QuizQuestionType } from '../type/quiz.type';

describe('TrackStructureValidator', () => {
  describe('computeStructuralSignature for video interjections', () => {
    it('should produce the same signature regardless of interjection order', () => {
      const interjection1 = {
        id: 'interjection-1',
        timestampSeconds: 10,
        question: {
          id: 'q1',
          type: QuizQuestionType.TRUE_FALSE,
          prompt: 'Is this a question?',
          correctAnswer: true,
        },
      };

      const interjection2 = {
        id: 'interjection-2',
        timestampSeconds: 20,
        question: {
          id: 'q2',
          type: QuizQuestionType.TRUE_FALSE,
          prompt: 'Is this another question?',
          correctAnswer: false,
        },
      };

      const baseVideoContent: Omit<VideoContent, 'interjections'> = {
        url: 'http://example.com/video.mp4',
        source: VideoSource.S3,
      };

      const sectionsA: UpsertTrackSectionDto[] = [
        {
          id: 'section-1',
          order: 1,
          title: 'Section 1',
          items: [
            {
              id: 'item-1',
              order: 1,
              title: 'Video Item',
              type: TrackItemType.VIDEO,
              content: {
                ...baseVideoContent,
                interjections: [interjection1, interjection2],
              },
            },
          ],
        },
      ];

      const sectionsB: UpsertTrackSectionDto[] = [
        {
          id: 'section-1',
          order: 1,
          title: 'Section 1',
          items: [
            {
              id: 'item-1',
              order: 1,
              title: 'Video Item',
              type: TrackItemType.VIDEO,
              content: {
                ...baseVideoContent,
                interjections: [interjection2, interjection1],
              },
            },
          ],
        },
      ];

      const signatureA = computeStructuralSignature(sectionsA);
      const signatureB = computeStructuralSignature(sectionsB);

      // This will fail before the fix, and pass after.
      expect(signatureA).toEqual(signatureB);
    });
  });
});
