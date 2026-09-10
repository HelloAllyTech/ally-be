import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserStatus } from '../../../user/constants/user-status.constants';
import { User } from '../../../user/entity/user.entity';
import { WaContact } from '../../entity/wa-contact.entity';
import { WaIdentitySource } from '../../enum/whatsapp.enum';
import { WhatsAppIdentityService } from '../whatsapp-identity.service';

/**
 * Identity resolution decides which organisation's documents answer a worker's question, so every
 * failure here is a wrong answer rather than an error: match the wrong person and the bot answers
 * out of a stranger's corpus, fail to match a real one and a working colleague is locked out.
 *
 * The rule under test throughout is ALL-OR-NOTHING — exactly one active user, or nobody.
 */
describe('WhatsAppIdentityService', () => {
  let service: WhatsAppIdentityService;
  let contactRepository: { update: jest.Mock };
  let candidates: Partial<User>[];
  let capturedParams: Record<string, unknown>;

  const contact = (over: Partial<WaContact> = {}): WaContact =>
    ({
      id: 'contact-1',
      phoneE164: '919876543210',
      phoneLast4: '3210',
      ...over,
    }) as WaContact;

  beforeEach(async () => {
    candidates = [];
    capturedParams = {};
    contactRepository = { update: jest.fn().mockResolvedValue(undefined) };

    const queryBuilder: Record<string, jest.Mock> = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn((_sql: string, params?: Record<string, unknown>) => {
        Object.assign(capturedParams, params ?? {});
        return queryBuilder;
      }),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn(() => Promise.resolve(candidates)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppIdentityService,
        {
          provide: getRepositoryToken(User),
          useValue: { createQueryBuilder: () => queryBuilder },
        },
        {
          provide: getRepositoryToken(WaContact),
          useValue: contactRepository,
        },
      ],
    }).compile();

    service = module.get(WhatsAppIdentityService);
  });

  describe('resolveByPhone', () => {
    it('matches a number stored in a different format', async () => {
      // The same phone, typed three ways, is what real profile data looks like.
      candidates = [{ id: 7, tenantId: 'tenant-a', phone: '+91 98765 43210' }];

      expect(await service.resolveByPhone('919876543210')).toEqual({
        userId: 7,
        tenantId: 'tenant-a',
      });
    });

    it('matches when the profile stores the national number and WhatsApp sends E.164', async () => {
      candidates = [{ id: 7, tenantId: 'tenant-a', phone: '9876543210' }];

      expect(await service.resolveByPhone('919876543210')).toEqual({
        userId: 7,
        tenantId: 'tenant-a',
      });
    });

    it('rejects a number that merely ends the same way in another country', async () => {
      // SQL matched on the last ten digits; this is the second check that stops '44...' being
      // treated as the same person as '91...'.
      candidates = [{ id: 7, tenantId: 'tenant-a', phone: '449876543210' }];

      expect(await service.resolveByPhone('919876543210')).toBeNull();
    });

    it('treats two matching users as unrecognised rather than picking one', async () => {
      candidates = [
        { id: 7, tenantId: 'tenant-a', phone: '919876543210' },
        { id: 8, tenantId: 'tenant-b', phone: '9876543210' },
      ];

      expect(await service.resolveByPhone('919876543210')).toBeNull();
    });

    it('only considers active users', async () => {
      await service.resolveByPhone('919876543210');

      expect(capturedParams.status).toBe(UserStatus.ACTIVE);
    });

    it('refuses a number too short to identify anyone', async () => {
      // A six-digit suffix would start matching strangers, so this never reaches the database.
      expect(await service.resolveByPhone('12345')).toBeNull();
    });

    it('returns null for a user with no organisation', async () => {
      candidates = [{ id: 7, tenantId: '', phone: '919876543210' }];

      expect(await service.resolveByPhone('919876543210')).toBeNull();
    });
  });

  describe('identify', () => {
    it('links a contact on first resolution', async () => {
      candidates = [{ id: 7, tenantId: 'tenant-a', phone: '919876543210' }];

      const result = await service.identify(contact());

      expect(result.tenantId).toBe('tenant-a');
      expect(contactRepository.update).toHaveBeenCalledWith(
        { id: 'contact-1' },
        expect.objectContaining({
          userId: 7,
          tenantId: 'tenant-a',
          identitySource: WaIdentitySource.PHONE,
        }),
      );
    });

    it('never overwrites a link an admin made by hand', async () => {
      // Someone linked this contact knowing the number does not match. Letting the automatic
      // path undo that on the next message would make the manual route pointless.
      candidates = [];

      const result = await service.identify(
        contact({
          userId: 9,
          tenantId: 'tenant-z',
          identitySource: WaIdentitySource.ADMIN,
        }),
      );

      expect(result.tenantId).toBe('tenant-z');
      expect(contactRepository.update).not.toHaveBeenCalled();
    });

    it('writes nothing when the link is already correct', async () => {
      candidates = [{ id: 7, tenantId: 'tenant-a', phone: '919876543210' }];

      await service.identify(
        contact({
          userId: 7,
          tenantId: 'tenant-a',
          identifiedAt: new Date(),
          identitySource: WaIdentitySource.PHONE,
        }),
      );

      expect(contactRepository.update).not.toHaveBeenCalled();
    });

    it('clears a link that no longer resolves', async () => {
      // The number was removed from the profile, or the account was suspended. From the worker's
      // side the bot simply stops recognising them, so the row must stop claiming otherwise.
      candidates = [];

      const result = await service.identify(
        contact({
          userId: 7,
          tenantId: 'tenant-a',
          identifiedAt: new Date(),
          identitySource: WaIdentitySource.PHONE,
        }),
      );

      expect(result.tenantId).toBeNull();
      expect(contactRepository.update).toHaveBeenCalledWith(
        { id: 'contact-1' },
        expect.objectContaining({
          userId: null,
          tenantId: null,
          identifiedAt: null,
          identitySource: null,
        }),
      );
    });

    it('re-resolves an unrecognised contact on every message', async () => {
      // The whole reason resolution is not first-contact-only: a number added to a profile after
      // someone first wrote has to start working on their next question, not via a support ticket.
      candidates = [{ id: 7, tenantId: 'tenant-a', phone: '919876543210' }];

      const result = await service.identify(
        contact({ userId: null, tenantId: null }),
      );

      expect(result.tenantId).toBe('tenant-a');
      expect(contactRepository.update).toHaveBeenCalled();
    });

    it('does not rewrite a contact that is still unrecognised', async () => {
      candidates = [];

      await service.identify(contact({ userId: null, tenantId: null }));

      expect(contactRepository.update).not.toHaveBeenCalled();
    });

    it('does not rewrite a brand-new contact whose fields are absent rather than null', async () => {
      // `resolveContact` creates a row without these fields at all, and `undefined === null`
      // is false — so the guard has to normalise, or every first message from an unknown
      // number costs a pointless write.
      candidates = [];

      await service.identify(contact());

      expect(contactRepository.update).not.toHaveBeenCalled();
    });
  });
});
