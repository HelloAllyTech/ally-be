import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { Tenant } from '../../../tenant/entity/tenant.entity';
import { User } from '../../../user/entity/user.entity';
import { WaPhoneMapping } from '../../entity/wa-phone-mapping.entity';
import { WhatsAppPhoneMappingService } from '../whatsapp-phone-mapping.service';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: jest.fn(),
    getTenantId: jest.fn(),
    getExecutionId: jest.fn(),
  },
}));

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

/**
 * Phone → organisation mappings.
 *
 * The behaviours pinned here are the ones whose failure is silent and in the wrong direction: a
 * number quietly moved between customers, a roster thrown away over one typo, or a file whose
 * two contradictory rows resolve to whichever happened to be last.
 */
describe('WhatsAppPhoneMappingService', () => {
  let service: WhatsAppPhoneMappingService;
  let mappingRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    softDelete: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let tenantRepository: { find: jest.Mock; count: jest.Mock };
  let userCandidates: Partial<User>[];

  beforeEach(async () => {
    (ExecutionManager.getUserId as jest.Mock).mockReturnValue(42);
    userCandidates = [];

    mappingRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (rows: unknown) => rows),
      update: jest.fn().mockResolvedValue(undefined),
      softDelete: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((row: Record<string, unknown>) => row),
      createQueryBuilder: jest.fn(),
    };
    tenantRepository = {
      find: jest.fn(async () => [
        { id: TENANT_A, name: 'Acme Health' },
        { id: TENANT_B, name: 'Beacon Care' },
      ]),
      count: jest.fn().mockResolvedValue(1),
    };

    const userQueryBuilder: Record<string, jest.Mock> = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn(() => Promise.resolve(userCandidates)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppPhoneMappingService,
        {
          provide: getRepositoryToken(WaPhoneMapping),
          useValue: mappingRepository,
        },
        { provide: getRepositoryToken(Tenant), useValue: tenantRepository },
        {
          provide: getRepositoryToken(User),
          useValue: { createQueryBuilder: () => userQueryBuilder },
        },
      ],
    }).compile();

    service = module.get(WhatsAppPhoneMappingService);
  });

  const bulkRow = (phone: string, over: Record<string, unknown> = {}) => ({
    phone,
    ...over,
  });

  describe('create', () => {
    it('stores the number normalised, whatever shape it was typed in', async () => {
      mappingRepository.findOne.mockResolvedValueOnce(null).mockResolvedValue({
        id: 'map-1',
        phoneE164: '919876543210',
        phoneKey: '9876543210',
        tenantId: TENANT_A,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.create({ phone: '+91 98765 43210', tenantId: TENANT_A });

      const created = mappingRepository.create.mock.calls[0][0];
      expect(created.phoneE164).toBe('919876543210');
      expect(created.phoneKey).toBe('9876543210');
    });

    it('refuses a number too short to identify anyone', async () => {
      await expect(
        service.create({ phone: '12345', tenantId: TENANT_A }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mappingRepository.save).not.toHaveBeenCalled();
    });

    it('refuses an organisation that does not exist', async () => {
      // The id ends up deciding which corpus a worker is answered from; a nonexistent one would
      // look correctly mapped in the table and resolve to nothing.
      tenantRepository.count.mockResolvedValue(0);

      await expect(
        service.create({ phone: '919876543210', tenantId: TENANT_A }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('moves a number that is already mapped elsewhere', async () => {
      // "Add this number to Acme" is the same intention whether or not the admin remembers
      // mapping it to Beacon last year, and a 409 would leave them hunting for a row they
      // cannot search by a number they typed differently.
      mappingRepository.findOne.mockResolvedValue({
        id: 'map-1',
        phoneE164: '919876543210',
        phoneKey: '9876543210',
        tenantId: TENANT_B,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.create({ phone: '919876543210', tenantId: TENANT_A });

      expect(mappingRepository.update).toHaveBeenCalledWith(
        { id: 'map-1' },
        expect.objectContaining({ tenantId: TENANT_A }),
      );
      expect(mappingRepository.save).not.toHaveBeenCalled();
    });

    it('attributes the mapping to a matching user without taking their organisation', async () => {
      // The organisation comes from the mapping, always. The user is a snapshot so an admin can
      // see who a number belongs to.
      userCandidates = [{ id: 7, tenantId: TENANT_B, phone: '919876543210' }];
      mappingRepository.findOne.mockResolvedValueOnce(null).mockResolvedValue({
        id: 'map-1',
        phoneE164: '919876543210',
        phoneKey: '9876543210',
        tenantId: TENANT_A,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.create({ phone: '919876543210', tenantId: TENANT_A });

      const created = mappingRepository.create.mock.calls[0][0];
      expect(created.userId).toBe(7);
      expect(created.tenantId).toBe(TENANT_A);
    });

    it('attributes nothing when two users share the number', async () => {
      // Same all-or-nothing rule as the resolver: naming one of two candidates would put the
      // wrong person's name against the mapping.
      userCandidates = [
        { id: 7, tenantId: TENANT_A, phone: '919876543210' },
        { id: 8, tenantId: TENANT_B, phone: '9876543210' },
      ];
      mappingRepository.findOne.mockResolvedValueOnce(null).mockResolvedValue({
        id: 'map-1',
        phoneE164: '919876543210',
        phoneKey: '9876543210',
        tenantId: TENANT_A,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.create({ phone: '919876543210', tenantId: TENANT_A });

      expect(mappingRepository.create.mock.calls[0][0].userId).toBeNull();
    });
  });

  describe('bulkCreate', () => {
    it('reports every row instead of rejecting the batch', async () => {
      // One mistyped number in a 200-line roster must not throw away the good rows — the admin
      // needs the lines to fix, not a rejected file.
      const result = await service.bulkCreate({
        rows: [
          bulkRow('919876543210'),
          bulkRow('123'),
          bulkRow('919876500000'),
        ],
        defaultTenantId: TENANT_A,
      });

      expect(result.created).toBe(2);
      expect(result.invalid).toBe(1);
      expect(result.results).toHaveLength(3);
      expect(result.results[1]).toMatchObject({ line: 2, outcome: 'invalid' });
    });

    it('leaves a number mapped to another organisation alone by default', async () => {
      // A file quietly moving numbers between customers is the kind of thing found out about
      // later, so it is reported and the admin re-runs deliberately.
      mappingRepository.find.mockResolvedValue([
        { id: 'map-1', phoneKey: '9876543210', tenantId: TENANT_B },
      ]);

      const result = await service.bulkCreate({
        rows: [bulkRow('919876543210')],
        defaultTenantId: TENANT_A,
      });

      expect(result.conflicts).toBe(1);
      expect(result.results[0].reason).toContain('Beacon Care');
      expect(mappingRepository.update).not.toHaveBeenCalled();
    });

    it('moves conflicting numbers when the admin asks for it', async () => {
      mappingRepository.find.mockResolvedValue([
        { id: 'map-1', phoneKey: '9876543210', tenantId: TENANT_B },
      ]);

      const result = await service.bulkCreate({
        rows: [bulkRow('919876543210')],
        defaultTenantId: TENANT_A,
        overwriteConflicts: true,
      });

      expect(result.updated).toBe(1);
      expect(mappingRepository.update).toHaveBeenCalledWith(
        { id: 'map-1' },
        expect.objectContaining({ tenantId: TENANT_A }),
      );
    });

    it('reports a number already mapped to the same organisation as unchanged', async () => {
      mappingRepository.find.mockResolvedValue([
        { id: 'map-1', phoneKey: '9876543210', tenantId: TENANT_A },
      ]);

      const result = await service.bulkCreate({
        rows: [bulkRow('919876543210')],
        defaultTenantId: TENANT_A,
      });

      expect(result.unchanged).toBe(1);
      expect(mappingRepository.update).not.toHaveBeenCalled();
    });

    it('reports a duplicate within one upload rather than picking one', async () => {
      // Two rows for the same handset naming different organisations is a mistake in the file.
      // Taking whichever came last would hide it.
      const result = await service.bulkCreate({
        rows: [
          bulkRow('919876543210', { tenantId: TENANT_A }),
          bulkRow('+91 98765 43210', { tenantId: TENANT_B }),
        ],
      });

      expect(result.created).toBe(1);
      expect(result.duplicates).toBe(1);
      expect(result.results[1]).toMatchObject({
        outcome: 'duplicate',
        reason: 'Same number as line 1',
      });
    });

    it('fails a row with no organisation rather than guessing one', async () => {
      const result = await service.bulkCreate({
        rows: [bulkRow('919876543210')],
      });

      expect(result.invalid).toBe(1);
      expect(result.results[0].reason).toBe('No organisation for this row');
    });

    it('lets a per-row organisation override the default', async () => {
      const result = await service.bulkCreate({
        rows: [bulkRow('919876543210', { tenantId: TENANT_B })],
        defaultTenantId: TENANT_A,
      });

      expect(result.created).toBe(1);
      expect(mappingRepository.create.mock.calls[0][0].tenantId).toBe(TENANT_B);
    });

    it('fails a row naming an organisation that does not exist', async () => {
      tenantRepository.find.mockResolvedValue([
        { id: TENANT_A, name: 'Acme Health' },
      ]);

      const result = await service.bulkCreate({
        rows: [bulkRow('919876543210', { tenantId: TENANT_B })],
      });

      expect(result.invalid).toBe(1);
      expect(result.results[0].reason).toBe('That organisation does not exist');
    });
  });

  describe('resolve', () => {
    it('answers with the mapped organisation, keyed on the normalised number', async () => {
      mappingRepository.findOne.mockResolvedValue({
        id: 'map-1',
        phoneKey: '9876543210',
        tenantId: TENANT_A,
        userId: 7,
      });

      expect(await service.resolve('+91 98765 43210')).toEqual({
        tenantId: TENANT_A,
        userId: 7,
      });
      expect(mappingRepository.findOne.mock.calls[0][0].where.phoneKey).toBe(
        '9876543210',
      );
    });

    it('does not query at all for a number too short to identify', async () => {
      expect(await service.resolve('123')).toBeNull();
      expect(mappingRepository.findOne).not.toHaveBeenCalled();
    });

    it('answers null for an unmapped number', async () => {
      expect(await service.resolve('919876543210')).toBeNull();
    });
  });
});
