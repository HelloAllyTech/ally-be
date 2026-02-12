import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ConversationalGuardrailsController } from '../conversational-guardrails.controller';
import { ConversationalGuardrailsService } from '../../service/conversational-guardrails.service';
import { ConversationalGuardrails } from '../../entity/conversational-guardrails.entity';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';

describe('ConversationalGuardrailsController', () => {
  let controller: ConversationalGuardrailsController;
  let service: jest.Mocked<ConversationalGuardrailsService>;

  const mockGuardrail: ConversationalGuardrails = {
    id: 'guardrail-uuid-1',
    name: 'Guardrail 1',
    helperDialogue: 'rude',
    actorDialogue: 'Please be respectful',
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as ConversationalGuardrails;

  const mockGuardrails: ConversationalGuardrails[] = [
    mockGuardrail,
    {
      id: 'guardrail-uuid-2',
      name: 'Guardrail 2',
      helperDialogue: 'interrupting',
      actorDialogue: 'Please let me finish',
      active: true,
      createdAt: new Date('2026-01-02'),
      updatedAt: new Date('2026-01-02'),
    } as ConversationalGuardrails,
  ];

  beforeEach(async () => {
    const mockService = {
      getGuardrails: jest.fn(),
      getGuardrailById: jest.fn(),
      createGuardrail: jest.fn(),
      updateGuardrail: jest.fn(),
      deleteGuardrail: jest.fn(),
      getRandomGuardrailsForSession: jest.fn(),
      countGuardrails: jest.fn(),
      getTranslationsByGuardrailId: jest.fn(),
      createTranslation: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConversationalGuardrailsController],
      providers: [
        {
          provide: ConversationalGuardrailsService,
          useValue: mockService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ConversationalGuardrailsController>(
      ConversationalGuardrailsController,
    );
    service = module.get(ConversationalGuardrailsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(controller).toBeDefined();
    });
  });

  describe('getGuardrails', () => {
    it('should return paginated guardrails', async () => {
      const mockResult = [mockGuardrail];
      service.getGuardrails.mockResolvedValue(mockResult);
      service.countGuardrails.mockResolvedValue(1);

      const result = await controller.getGuardrails('search', 10, 0);

      expect(result).toEqual({ data: mockResult, total: 1 });
      expect(service.getGuardrails).toHaveBeenCalledWith('search', {
        limit: 10,
        offset: 0,
        sortBy: undefined,
        order: undefined,
      });
    });

    it('should pass search parameter to service', async () => {
      service.getGuardrails.mockResolvedValue([mockGuardrail]);
      service.countGuardrails.mockResolvedValue(1);

      await controller.getGuardrails('rude', 10, 0);

      expect(service.getGuardrails).toHaveBeenCalledWith('rude', {
        limit: 10,
        offset: 0,
        sortBy: undefined,
        order: undefined,
      });
    });
  });

  describe('getGuardrailById', () => {
    it('should return guardrail by id', async () => {
      service.getGuardrailById.mockResolvedValue(mockGuardrail);

      const result = await controller.getGuardrailById('guardrail-uuid-1');

      expect(result).toEqual(mockGuardrail);
      expect(service.getGuardrailById).toHaveBeenCalledWith('guardrail-uuid-1');
    });

    it('should throw NotFoundException when not found', async () => {
      service.getGuardrailById.mockRejectedValue(new NotFoundException());

      await expect(controller.getGuardrailById('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createGuardrail', () => {
    it('should create a new guardrail', async () => {
      const createDto = {
        name: 'new guardrail',
        helperDialogue: 'new helper',
        actorDialogue: 'new response',
        active: true,
      };
      service.createGuardrail.mockResolvedValue({ ...mockGuardrail, ...createDto });

      const result = await controller.createGuardrail(createDto);

      expect(result.name).toBe('new guardrail');
      expect(result.helperDialogue).toBe('new helper');
      expect(service.createGuardrail).toHaveBeenCalledWith(createDto);
    });
  });

  describe('updateGuardrail', () => {
    it('should update an existing guardrail', async () => {
      const updateDto = { helperDialogue: 'updated' };
      service.updateGuardrail.mockResolvedValue({ ...mockGuardrail, ...updateDto });

      const result = await controller.updateGuardrail('guardrail-uuid-1', updateDto);

      expect(result.helperDialogue).toBe('updated');
      expect(service.updateGuardrail).toHaveBeenCalledWith(
        'guardrail-uuid-1',
        updateDto,
      );
    });
  });

  describe('deleteGuardrail', () => {
    it('should delete a guardrail', async () => {
      service.deleteGuardrail.mockResolvedValue({ success: true });

      const result = await controller.deleteGuardrail('guardrail-uuid-1');

      expect(result).toEqual({ success: true });
      expect(service.deleteGuardrail).toHaveBeenCalledWith('guardrail-uuid-1');
    });
  });

  describe('getRandomGuardrails', () => {
    it('should return random active guardrails', async () => {
      service.getRandomGuardrailsForSession.mockResolvedValue(mockGuardrails);

      const result = await controller.getRandomGuardrails();

      expect(result).toEqual(mockGuardrails);
      expect(service.getRandomGuardrailsForSession).toHaveBeenCalled();
    });

    it('should pass languageId when provided', async () => {
      service.getRandomGuardrailsForSession.mockResolvedValue(mockGuardrails);

      await controller.getRandomGuardrails(2);

      expect(service.getRandomGuardrailsForSession).toHaveBeenCalledWith(2);
    });
  });
});
