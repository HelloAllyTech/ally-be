import {
  computeSystemFieldValue,
  isSystemFieldSeedKey,
  SYSTEM_FIELD_SEED_KEYS,
  SystemFieldContext,
} from '../system-field-computer';
import { Chat } from '../../../chat/entity/chat.entity';
import { CallDetails } from '../../../chat/entity/call.details.entity';
import { ScribeSessionMode } from '../../../common/constants/chat.constants';

describe('system-field-computer', () => {
  const baseChat: Chat = {
    id: 100,
    clientId: 55,
    counselorId: 7,
    startedAt: new Date('2026-01-01T10:00:00.000Z'),
    endedAt: new Date('2026-01-01T10:30:00.000Z'),
    tenantId: 'tenant-uuid',
  } as any;

  const baseCallDetails: CallDetails = {
    chatId: 100,
    callDuration: 1800,
    startTime: new Date('2026-01-01T10:00:00.000Z'),
    callInfo: {
      clientTalkingPercentage: 0.42,
      mode: ScribeSessionMode.SCRIBE,
    },
    tenantId: 'tenant-uuid',
  } as any;

  const baseContext = (
    overrides: Partial<SystemFieldContext> = {},
  ): SystemFieldContext => ({
    chat: baseChat,
    callDetails: baseCallDetails,
    counselorName: 'Jane Counselor',
    ...overrides,
  });

  describe('isSystemFieldSeedKey', () => {
    it('returns true for every known SYSTEM seedKey', () => {
      for (const key of SYSTEM_FIELD_SEED_KEYS) {
        expect(isSystemFieldSeedKey(key)).toBe(true);
      }
    });

    it('returns false for an unrecognized seedKey', () => {
      expect(isSystemFieldSeedKey('keyConcerns')).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isSystemFieldSeedKey(null)).toBe(false);
      expect(isSystemFieldSeedKey(undefined)).toBe(false);
    });
  });

  describe('SYSTEM_FIELD_SEED_KEYS', () => {
    it('covers exactly the 8 documented SYSTEM fields', () => {
      expect(new Set(SYSTEM_FIELD_SEED_KEYS)).toEqual(
        new Set([
          'callId',
          'callDuration',
          'callDate',
          'callTime',
          'clientId',
          'counsellorName',
          'listeningShare',
          'mode',
        ]),
      );
    });
  });

  describe('callId', () => {
    it('returns the chat id as a string', () => {
      expect(computeSystemFieldValue('callId', baseContext())).toBe('100');
    });
  });

  describe('callDuration', () => {
    it('returns raw seconds as a string', () => {
      expect(computeSystemFieldValue('callDuration', baseContext())).toBe(
        '1800',
      );
    });

    it('returns null when callDetails is missing', () => {
      expect(
        computeSystemFieldValue(
          'callDuration',
          baseContext({ callDetails: null }),
        ),
      ).toBeNull();
    });

    it('returns null when callDuration itself is null', () => {
      const ctx = baseContext({
        callDetails: { ...baseCallDetails, callDuration: undefined } as any,
      });
      expect(computeSystemFieldValue('callDuration', ctx)).toBeNull();
    });
  });

  describe('callDate', () => {
    it('returns CallDetails.startTime as an ISO string', () => {
      expect(computeSystemFieldValue('callDate', baseContext())).toBe(
        '2026-01-01T10:00:00.000Z',
      );
    });

    it('returns null when callDetails or startTime is missing', () => {
      expect(
        computeSystemFieldValue('callDate', baseContext({ callDetails: null })),
      ).toBeNull();
      expect(
        computeSystemFieldValue(
          'callDate',
          baseContext({
            callDetails: { ...baseCallDetails, startTime: undefined } as any,
          }),
        ),
      ).toBeNull();
    });
  });

  describe('callTime', () => {
    it('returns startedAt and endedAt joined by "|"', () => {
      expect(computeSystemFieldValue('callTime', baseContext())).toBe(
        '2026-01-01T10:00:00.000Z|2026-01-01T10:30:00.000Z',
      );
    });

    it('returns null when either startedAt or endedAt is missing', () => {
      expect(
        computeSystemFieldValue(
          'callTime',
          baseContext({ chat: { ...baseChat, endedAt: undefined } as any }),
        ),
      ).toBeNull();
      expect(
        computeSystemFieldValue(
          'callTime',
          baseContext({ chat: { ...baseChat, startedAt: undefined } as any }),
        ),
      ).toBeNull();
    });
  });

  describe('clientId', () => {
    it('returns clientId as a string', () => {
      expect(computeSystemFieldValue('clientId', baseContext())).toBe('55');
    });

    it('returns null for the -1 sentinel (unknown/deleted client)', () => {
      expect(
        computeSystemFieldValue(
          'clientId',
          baseContext({ chat: { ...baseChat, clientId: -1 } as any }),
        ),
      ).toBeNull();
    });
  });

  describe('counsellorName', () => {
    it('returns the resolved counselor name', () => {
      expect(computeSystemFieldValue('counsellorName', baseContext())).toBe(
        'Jane Counselor',
      );
    });

    it('returns null when no counselor name was resolved', () => {
      expect(
        computeSystemFieldValue(
          'counsellorName',
          baseContext({ counselorName: null }),
        ),
      ).toBeNull();
    });
  });

  describe('listeningShare', () => {
    it('returns the raw talking-percentage ratio as a string', () => {
      expect(computeSystemFieldValue('listeningShare', baseContext())).toBe(
        '0.42',
      );
    });

    it('returns null when clientTalkingPercentage is missing', () => {
      expect(
        computeSystemFieldValue(
          'listeningShare',
          baseContext({
            callDetails: { ...baseCallDetails, callInfo: {} } as any,
          }),
        ),
      ).toBeNull();
    });

    it('distinguishes 0 from missing (does not treat 0% as absent)', () => {
      expect(
        computeSystemFieldValue(
          'listeningShare',
          baseContext({
            callDetails: {
              ...baseCallDetails,
              callInfo: { clientTalkingPercentage: 0 },
            } as any,
          }),
        ),
      ).toBe('0');
    });
  });

  describe('mode', () => {
    it('maps DICTATION to "Dictation"', () => {
      const ctx = baseContext({
        callDetails: {
          ...baseCallDetails,
          callInfo: { mode: ScribeSessionMode.DICTATION },
        } as any,
      });
      expect(computeSystemFieldValue('mode', ctx)).toBe('Dictation');
    });

    it('maps SCRIBE to "Scribe"', () => {
      expect(computeSystemFieldValue('mode', baseContext())).toBe('Scribe');
    });

    it('defaults to "Scribe" when callInfo/mode is missing', () => {
      expect(
        computeSystemFieldValue('mode', baseContext({ callDetails: null })),
      ).toBe('Scribe');
    });
  });

  describe('unrecognized seedKey', () => {
    it('returns null rather than throwing', () => {
      expect(
        computeSystemFieldValue('notARealSeedKey', baseContext()),
      ).toBeNull();
    });
  });
});
