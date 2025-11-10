import { ChatUtil } from '../chat.util';
import { FlattenedSummaryNotePayloadCamelCase } from '../../type/call.details.type';
import { Chat, ChatStatus, ChatSummaryStatus } from '../../entity/chat.entity';

describe('ChatUtil', () => {
  describe('isValidSummary', () => {
    it('should return false when summary is undefined', () => {
      const result = (ChatUtil as any).isValidSummary(undefined);
      expect(result).toBe(false);
    });

    it('should return false when summary is null', () => {
      const result = (ChatUtil as any).isValidSummary(null);
      expect(result).toBe(false);
    });

    it('should return false when summary is empty object', () => {
      const result = (ChatUtil as any).isValidSummary({});
      expect(result).toBe(false);
    });

    it('should return true when summary is valid object', () => {
      const summary = {
        age: 25,
        gender: 'Male',
      } as FlattenedSummaryNotePayloadCamelCase;
      const result = (ChatUtil as any).isValidSummary(summary);
      expect(result).toBe(true);
    });
  });

  describe('isDemographicDetailsAvailable', () => {
    it('should return false when summary is invalid', () => {
      const result = ChatUtil.isDemographicDetailsAvailable(undefined);
      expect(result).toBe(false);
    });

    it('should return false when no demographic details are available', () => {
      const summary = {
        tags: [
          { tag: 'test', positivity_rating: 0.5 },
          { tag: 'example', positivity_rating: 0.7 },
        ],
      } as FlattenedSummaryNotePayloadCamelCase;
      const result = ChatUtil.isDemographicDetailsAvailable(summary);
      expect(result).toBe(false);
    });

    it('should return true when at least one demographic detail is available', () => {
      const summary = {
        age: 25,
        gender: 'Male',
        location: 'New York',
        profession: 'software engineer',
        relationshipStatus: 'single',
        languages: [{ language: 'en', percentage: 100 }],
        codeOfConcern: 'anxiety',
      } as FlattenedSummaryNotePayloadCamelCase;
      const result = ChatUtil.isDemographicDetailsAvailable(summary);
      expect(result).toBe(true);
    });
  });

  describe('isTagsAvailable', () => {
    it('should return false when summary is invalid', () => {
      const result = ChatUtil.isTagsAvailable(undefined);
      expect(result).toBe(false);
    });

    it('should return false when no tags are available', () => {
      const summary = {
        age: 25,
      } as FlattenedSummaryNotePayloadCamelCase;
      const result = ChatUtil.isTagsAvailable(summary);
      expect(result).toBe(false);
    });

    it('should return true when tags are available', () => {
      const summary = {
        tags: [
          { tag: 'test', positivity_rating: 0.5 },
          { tag: 'example', positivity_rating: 0.7 },
        ],
      } as FlattenedSummaryNotePayloadCamelCase;
      const result = ChatUtil.isTagsAvailable(summary);
      expect(result).toBe(true);
    });
  });

  describe('isCallQualityAvailable', () => {
    it('should return false when summary is invalid', () => {
      const result = ChatUtil.isCallQualityAvailable(undefined);
      expect(result).toBe(false);
    });

    it('should return false when no call quality is available', () => {
      const summary = {
        age: 25,
      } as FlattenedSummaryNotePayloadCamelCase;
      const result = ChatUtil.isCallQualityAvailable(summary);
      expect(result).toBe(false);
    });

    it('should return true when call quality is available', () => {
      const summary = {
        callQuality: 5,
      } as FlattenedSummaryNotePayloadCamelCase;
      const result = ChatUtil.isCallQualityAvailable(summary);
      expect(result).toBe(true);
    });
  });

  describe('getSummaryName', () => {
    it('should use startedAt when available', () => {
      const chat = {
        id: 123,
        startedAt: new Date('2023-01-15T10:00:00Z'),
        createdAt: new Date('2023-01-15T09:00:00Z'),
      } as Chat;

      const result = ChatUtil.getSummaryName(chat);
      expect(result).toBe('CALL-123-2023-01-15');
    });

    it('should use createdAt when startedAt is not available', () => {
      const chat = {
        id: 456,
        startedAt: new Date('2023-02-20T14:30:00Z'),
        createdAt: new Date('2023-02-20T14:30:00Z'),
        roomId: 1,
        clientId: 1,
        status: ChatStatus.ACTIVE,
        summaryStatus: ChatSummaryStatus.PENDING,
        endedAt: new Date('2023-02-20T15:00:00Z'),
        tenantId: 'test-tenant',
        externalId: 'test-external-id',
        updatedAt: new Date(),
      };

      const result = ChatUtil.getSummaryName(chat);
      expect(result).toBe('CALL-456-2023-02-20');
    });
  });

  describe('getCallDurationInSeconds', () => {
    it('should return 0 when startDate is falsy', () => {
      const result = ChatUtil.getCallDurationInSeconds(null as any, new Date());
      expect(result).toBe(0);
    });

    it('should return 0 when endDate is falsy', () => {
      const result = ChatUtil.getCallDurationInSeconds(new Date(), null as any);
      expect(result).toBe(0);
    });

    it('should return 0 when both dates are falsy', () => {
      const result = ChatUtil.getCallDurationInSeconds(
        null as any,
        null as any,
      );
      expect(result).toBe(0);
    });

    it('should return correct duration when both dates are provided', () => {
      const startDate = new Date('2023-01-15T10:00:00Z');
      const endDate = new Date('2023-01-15T10:05:30Z');

      const result = ChatUtil.getCallDurationInSeconds(startDate, endDate);
      expect(result).toBe(330);
    });

    it('should return 0 when endDate is before startDate', () => {
      const startDate = new Date('2023-01-15T10:00:00Z');
      const endDate = new Date('2023-01-15T09:00:00Z');

      const result = ChatUtil.getCallDurationInSeconds(startDate, endDate);
      expect(result).toBe(0);
    });
  });
});
