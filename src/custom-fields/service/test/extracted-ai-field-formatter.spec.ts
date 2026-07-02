import { formatExtractedAiFieldValue } from '../extracted-ai-field-formatter';
import { FlattenedSummaryNotePayloadCamelCase } from '../../../chat/type/call.details.type';

describe('extracted-ai-field-formatter', () => {
  const baseResponse = {} as FlattenedSummaryNotePayloadCamelCase;

  describe('callType', () => {
    it('passes the string through as-is', () => {
      expect(
        formatExtractedAiFieldValue('callType', {
          ...baseResponse,
          callType: 'Regular',
        } as any),
      ).toBe('Regular');
    });

    it('returns null when absent', () => {
      expect(
        formatExtractedAiFieldValue('callType', {
          ...baseResponse,
          callType: null,
        } as any),
      ).toBeNull();
    });
  });

  describe('languages', () => {
    it('formats each language as "Label (XX.X%)" joined by ", "', () => {
      const result = formatExtractedAiFieldValue('languages', {
        ...baseResponse,
        languages: [
          { language: 'hindi', percentage: 60 },
          { language: 'english', percentage: 40 },
        ],
      } as any);
      expect(result).toMatch(/60\.0%/);
      expect(result).toMatch(/40\.0%/);
      expect(result).toContain(', ');
    });

    it('falls back to the raw language code when not in LANGUAGE_MAP', () => {
      const result = formatExtractedAiFieldValue('languages', {
        ...baseResponse,
        languages: [{ language: 'klingon', percentage: 100 }],
      } as any);
      expect(result).toBe('klingon (100.0%)');
    });

    it('returns null for an empty array', () => {
      expect(
        formatExtractedAiFieldValue('languages', {
          ...baseResponse,
          languages: [],
        } as any),
      ).toBeNull();
    });
  });

  describe('reflectiveQuestionsAsked / openEndedQuestionsAsked', () => {
    it('converts a number to a string', () => {
      expect(
        formatExtractedAiFieldValue('reflectiveQuestionsAsked', {
          ...baseResponse,
          reflectiveQuestionsAsked: 5,
        } as any),
      ).toBe('5');
      expect(
        formatExtractedAiFieldValue('openEndedQuestionsAsked', {
          ...baseResponse,
          openEndedQuestionsAsked: 3,
        } as any),
      ).toBe('3');
    });

    it('distinguishes 0 from missing', () => {
      expect(
        formatExtractedAiFieldValue('reflectiveQuestionsAsked', {
          ...baseResponse,
          reflectiveQuestionsAsked: 0,
        } as any),
      ).toBe('0');
    });

    it('returns null when missing', () => {
      expect(
        formatExtractedAiFieldValue('openEndedQuestionsAsked', {
          ...baseResponse,
          openEndedQuestionsAsked: undefined,
        } as any),
      ).toBeNull();
    });
  });

  describe('emotionalLift', () => {
    it('passes the string through as-is', () => {
      expect(
        formatExtractedAiFieldValue('emotionalLift', {
          ...baseResponse,
          emotionalLift: 'Client felt calmer',
        } as any),
      ).toBe('Client felt calmer');
    });
  });

  describe('callQuality', () => {
    it('converts a number to a string', () => {
      expect(
        formatExtractedAiFieldValue('callQuality', {
          ...baseResponse,
          callQuality: 87,
        } as any),
      ).toBe('87');
    });

    it('distinguishes 0 from missing', () => {
      expect(
        formatExtractedAiFieldValue('callQuality', {
          ...baseResponse,
          callQuality: 0,
        } as any),
      ).toBe('0');
    });

    it('returns null when missing', () => {
      expect(
        formatExtractedAiFieldValue('callQuality', {
          ...baseResponse,
          callQuality: null,
        } as any),
      ).toBeNull();
    });
  });

  describe('unrecognized key', () => {
    it('returns null rather than throwing', () => {
      expect(
        formatExtractedAiFieldValue('notARealKey', baseResponse),
      ).toBeNull();
    });
  });
});
