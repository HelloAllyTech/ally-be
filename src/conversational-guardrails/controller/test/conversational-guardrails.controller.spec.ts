import { Test, TestingModule } from '@nestjs/testing';
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

      const result = await controller.getGuardrails('search', 10, 0);

      expect(result).toEqual(mockResult);
      expect(service.getGuardrails).toHaveBeenCalledWith('search', {
        limit: 10,
        offset: 0,
        sortBy: undefined,
        order: undefined,
      });
    });

    it('should pass search parameter to service', async () => {
      service.getGuardrails.mockResolvedValue([mockGuardrail]);

      await controller.getGuardrails('rude', 10, 0);

      expect(service.getGuardrails).toHaveBeenCalledWith('rude', {
        limit: 10,
        offset: 0,
        sortBy: undefined,
        order: undefined,
      });
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
      service.createGuardrail.mockResolvedValue({
        ...mockGuardrail,
        ...createDto,
      });

      const result = await controller.createGuardrail(createDto);

      expect(result.name).toBe('new guardrail');
      expect(result.helperDialogue).toBe('new helper');
      expect(service.createGuardrail).toHaveBeenCalledWith(createDto);
    });
  });

  describe('updateGuardrail', () => {
    it('should update an existing guardrail', async () => {
      const updateDto = { helperDialogue: 'updated' };
      service.updateGuardrail.mockResolvedValue({
        ...mockGuardrail,
        ...updateDto,
      });

      const result = await controller.updateGuardrail(
        'guardrail-uuid-1',
        updateDto,
      );

      expect(result.helperDialogue).toBe('updated');
      expect(service.updateGuardrail).toHaveBeenCalledWith(
        'guardrail-uuid-1',
        updateDto,
      );
    });
  });
});
