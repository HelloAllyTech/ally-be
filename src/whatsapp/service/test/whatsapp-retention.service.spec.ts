import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WaContact } from '../../entity/wa-contact.entity';
import { WaConversation } from '../../entity/wa-conversation.entity';
import { WaMessage } from '../../entity/wa-message.entity';
import { WaUnansweredQuestion } from '../../entity/wa-unanswered-question.entity';
import {
  ERASED,
  ERASED_PHONE_PREFIX,
  WhatsAppRetentionService,
} from '../whatsapp-retention.service';
import { WhatsAppSettingsService } from '../whatsapp-settings.service';

/**
 * The retention sweep is the bound on how long identifiable data about mental healthcare workers
 * exists at all — masking only bounds who sees it. Three properties are worth pinning:
 *
 *  - `retentionDays: 0` disables it. A default that silently means "never" would be the wrong
 *    permissive default for exactly this setting, so "off" has to be a deliberate value.
 *  - It BLANKS rather than deletes. Deleting rows would shrink last quarter's usage figures every
 *    month as the window rolled, which makes the dashboard quietly untrustworthy.
 *  - It is idempotent. Already-erased rows are excluded, so a re-run is a no-op instead of a second
 *    pass of writes over the same data.
 */
describe('WhatsAppRetentionService', () => {
  let service: WhatsAppRetentionService;
  let messageRepository: {
    count: jest.Mock;
    find: jest.Mock;
    update: jest.Mock;
  };
  let contactRepository: { findOne: jest.Mock; update: jest.Mock };
  let conversationRepository: { createQueryBuilder: jest.Mock };
  let unansweredRepository: { update: jest.Mock };
  let settingsService: { get: jest.Mock };

  const staleContactsQuery = (contactIds: string[]) => ({
    select: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    having: jest.fn().mockReturnThis(),
    getRawMany: jest
      .fn()
      .mockResolvedValue(contactIds.map((id) => ({ contactId: id }))),
  });

  beforeEach(async () => {
    messageRepository = {
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    contactRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    conversationRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(staleContactsQuery([])),
    };
    unansweredRepository = {
      update: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    settingsService = {
      get: jest.fn().mockResolvedValue({ retentionDays: 180 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppRetentionService,
        { provide: getRepositoryToken(WaMessage), useValue: messageRepository },
        { provide: getRepositoryToken(WaContact), useValue: contactRepository },
        {
          provide: getRepositoryToken(WaConversation),
          useValue: conversationRepository,
        },
        {
          provide: getRepositoryToken(WaUnansweredQuestion),
          useValue: unansweredRepository,
        },
        { provide: WhatsAppSettingsService, useValue: settingsService },
      ],
    }).compile();

    service = module.get(WhatsAppRetentionService);
  });

  describe('the off switch', () => {
    it.each([0, -1, undefined, null])(
      'does nothing when retentionDays is %s',
      async (retentionDays) => {
        settingsService.get.mockResolvedValue({ retentionDays });

        await service.runRetentionSweep();

        expect(messageRepository.count).not.toHaveBeenCalled();
        expect(messageRepository.update).not.toHaveBeenCalled();
        expect(contactRepository.update).not.toHaveBeenCalled();
      },
    );
  });

  describe('when nothing is past the cutoff', () => {
    it('stops after the count rather than running every blanking pass', async () => {
      // The sweep runs hourly, so the overwhelming majority of runs land here. It must cost one
      // indexed COUNT and nothing else.
      messageRepository.count.mockResolvedValue(0);

      await service.runRetentionSweep();

      expect(messageRepository.count).toHaveBeenCalledTimes(1);
      expect(messageRepository.find).not.toHaveBeenCalled();
      expect(unansweredRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('blanking', () => {
    beforeEach(() => {
      messageRepository.count.mockResolvedValue(2);
      messageRepository.find.mockResolvedValueOnce([
        { id: 'm-1' },
        { id: 'm-2' },
      ]);
    });

    it('overwrites bodies instead of deleting rows', async () => {
      await service.runRetentionSweep();

      expect(messageRepository.update).toHaveBeenCalledTimes(1);
      const [, patch] = messageRepository.update.mock.calls[0];
      expect(patch.body).toBe(ERASED);
      // The citation array and retrieval metadata go with the body: they tie document ids and page
      // numbers to one worker's specific question, which is the association being aged out.
      expect(patch.citations).toBeNull();
      expect(patch.retrievalMeta).toBeNull();
    });

    it('excludes already-erased rows so a re-run is a no-op', async () => {
      await service.runRetentionSweep();

      // Not(ERASED) — asserted through the operator's shape rather than by string match, since
      // TypeORM wraps it.
      const where = messageRepository.find.mock.calls[0][0].where;
      expect(where.body).toBeDefined();
      expect(JSON.stringify(where.body)).toContain(ERASED);
    });

    it('blanks unanswered question text too', async () => {
      await service.runRetentionSweep();

      const [, patch] = unansweredRepository.update.mock.calls[0];
      expect(patch.questionText).toBe(ERASED);
    });
  });

  describe('contact numbers', () => {
    beforeEach(() => {
      messageRepository.count.mockResolvedValue(1);
      messageRepository.find.mockResolvedValueOnce([{ id: 'm-1' }]);
    });

    it('blanks the number of a contact whose every thread is past the cutoff', async () => {
      conversationRepository.createQueryBuilder.mockReturnValue(
        staleContactsQuery(['c-1']),
      );
      contactRepository.findOne.mockResolvedValue({
        id: 'c-1',
        phoneE164: '+919876543210',
      });

      await service.runRetentionSweep();

      const [criteria, patch] = contactRepository.update.mock.calls[0];
      expect(criteria).toEqual({ id: 'c-1' });
      expect(patch.phoneE164).toBe(`${ERASED_PHONE_PREFIX}c-1`);
      // A placeholder rather than null: the column is unique and NOT NULL, and reusing the id keeps
      // the row identifiable for audit without holding the number.
      expect(patch.phoneLast4).toBe('0000');
    });

    it('skips a contact whose number is already erased', async () => {
      conversationRepository.createQueryBuilder.mockReturnValue(
        staleContactsQuery(['c-1']),
      );
      contactRepository.findOne.mockResolvedValue({
        id: 'c-1',
        phoneE164: `${ERASED_PHONE_PREFIX}c-1`,
      });

      await service.runRetentionSweep();

      expect(contactRepository.update).not.toHaveBeenCalled();
    });

    it('leaves a contact with recent activity alone', async () => {
      // The HAVING MAX(last_message_at) < cutoff is what enforces this: a contact who messaged a year
      // ago and again yesterday must keep their number, because the recent thread is still in window
      // and an admin may still need to act on it.
      conversationRepository.createQueryBuilder.mockReturnValue(
        staleContactsQuery([]),
      );

      await service.runRetentionSweep();

      expect(contactRepository.findOne).not.toHaveBeenCalled();
      expect(contactRepository.update).not.toHaveBeenCalled();
    });
  });
});
