import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { TooltipService } from '../tooltip.service';
import { TooltipTranslationService } from '../tooltip-translation.service';
import { TooltipRepository } from '../../repository/tooltip.repository';
import { Tooltip } from '../../entity/tooltip.entity';
import { CreateTooltipDto } from '../../dto/create-tooltip.dto';
import { UpdateTooltipDto } from '../../dto/update-tooltip.dto';
import { NotFoundException } from 'src/exception/custom.exception';
import { ExecutionManager } from 'src/common/execution/execution-manager';

describe('TooltipService', () => {
  let service: TooltipService;
  let tooltipRepository: jest.Mocked<TooltipRepository>;
  let translationService: jest.Mocked<TooltipTranslationService>;

  const mockTooltip: Tooltip = {
    id: 'tooltip-uuid-1',
    location: 'login_button',
    tipText: 'Click here to log in',
    icon: '😀',
    active: true,
    createdBy: 42,
    updatedBy: 42,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as Tooltip;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TooltipService,
        {
          provide: TooltipRepository,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            getTooltips: jest.fn(),
          },
        },
        {
          provide: TooltipTranslationService,
          useValue: {
            createUpdateTooltipTranslations: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<TooltipService>(TooltipService);
    tooltipRepository = module.get(TooltipRepository);
    translationService = module.get(TooltipTranslationService);

    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('42');
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('createTooltip', () => {
    const createDto: CreateTooltipDto = {
      location: 'login_button',
      tipText: 'Click here to log in',
      icon: '😀',
      active: false,
    };

    it('should create and save a tooltip successfully', async () => {
      tooltipRepository.create.mockReturnValue(mockTooltip);
      tooltipRepository.save.mockResolvedValue(mockTooltip);

      const result = await service.createTooltip(createDto);

      expect(tooltipRepository.create).toHaveBeenCalledWith({
        ...createDto,
        createdBy: 42,
        updatedBy: 42,
      });
      expect(tooltipRepository.save).toHaveBeenCalledWith(mockTooltip);
      expect(result).toEqual(mockTooltip);
    });

    it('should throw ConflictException when location already exists (duplicate key)', async () => {
      tooltipRepository.create.mockReturnValue(mockTooltip);
      const duplicateError = Object.assign(new Error('duplicate key'), {
        name: 'QueryFailedError',
        code: '23505',
      });
      tooltipRepository.save.mockRejectedValue(duplicateError);

      await expect(service.createTooltip(createDto)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.createTooltip(createDto)).rejects.toThrow(
        'login_button',
      );
    });

    it('should rethrow non-duplicate errors from save', async () => {
      tooltipRepository.create.mockReturnValue(mockTooltip);
      tooltipRepository.save.mockRejectedValue(new Error('Connection lost'));

      await expect(service.createTooltip(createDto)).rejects.toThrow(
        'Connection lost',
      );
    });
  });

  describe('updateTooltip', () => {
    const tooltipId = 'tooltip-uuid-1';
    const updateDto: UpdateTooltipDto = {
      tipText: 'Updated tip text',
      active: false,
    };

    it('should return true when update succeeds', async () => {
      tooltipRepository.findOne.mockResolvedValue(mockTooltip);
      tooltipRepository.update.mockResolvedValue({ affected: 1 } as any);

      const result = await service.updateTooltip(tooltipId, updateDto);

      expect(tooltipRepository.findOne).toHaveBeenCalledWith({
        where: { id: tooltipId },
      });
      expect(tooltipRepository.update).toHaveBeenCalledWith(tooltipId, {
        ...updateDto,
        updatedBy: 42,
      });
      expect(result).toBe(true);
    });

    it('should return false when update affects no rows', async () => {
      tooltipRepository.findOne.mockResolvedValue(mockTooltip);
      tooltipRepository.update.mockResolvedValue({ affected: 0 } as any);

      const result = await service.updateTooltip(tooltipId, updateDto);

      expect(result).toBe(false);
    });

    it('should throw NotFoundException when tooltip does not exist', async () => {
      tooltipRepository.findOne.mockResolvedValue(null);

      await expect(service.updateTooltip(tooltipId, updateDto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.updateTooltip(tooltipId, updateDto)).rejects.toThrow(
        'Tooltip not found',
      );
    });

    it('should throw ConflictException on duplicate location during update', async () => {
      tooltipRepository.findOne.mockResolvedValue(mockTooltip);
      const duplicateError = Object.assign(new Error('duplicate key'), {
        name: 'QueryFailedError',
        code: '23505',
      });
      tooltipRepository.update.mockRejectedValue(duplicateError);

      await expect(
        service.updateTooltip(tooltipId, { location: 'login_button' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should rethrow non-duplicate errors from update', async () => {
      tooltipRepository.findOne.mockResolvedValue(mockTooltip);
      tooltipRepository.update.mockRejectedValue(new Error('Connection lost'));

      await expect(service.updateTooltip(tooltipId, updateDto)).rejects.toThrow(
        'Connection lost',
      );
    });
  });

  describe('getTooltips', () => {
    const mockTooltips: Tooltip[] = [
      mockTooltip,
      {
        id: 'tooltip-uuid-2',
        location: 'profile_icon',
        tipText: 'View your profile',
        icon: '',
        active: false,
        createdBy: 1,
        updatedBy: 1,
        createdAt: new Date('2026-01-02'),
        updatedAt: new Date('2026-01-02'),
      } as Tooltip,
    ];

    it('should return all tooltips with pagination options', async () => {
      tooltipRepository.getTooltips.mockResolvedValue(mockTooltips);

      const result = await service.getTooltips(undefined, {
        limit: 10,
        offset: 0,
      });

      expect(tooltipRepository.getTooltips).toHaveBeenCalledWith(undefined, {
        limit: 10,
        offset: 0,
      });
      expect(result).toEqual(mockTooltips);
    });

    it('should return tooltips filtered by search term', async () => {
      const filtered = [mockTooltip];
      tooltipRepository.getTooltips.mockResolvedValue(filtered);

      const result = await service.getTooltips('login', { limit: 30, offset: 0 });

      expect(tooltipRepository.getTooltips).toHaveBeenCalledWith('login', {
        limit: 30,
        offset: 0,
      });
      expect(result).toEqual(filtered);
    });

    it('should return empty array when no tooltips match', async () => {
      tooltipRepository.getTooltips.mockResolvedValue([]);

      const result = await service.getTooltips('nonexistent');

      expect(result).toEqual([]);
    });

    it('should pass sorting options to the repository', async () => {
      tooltipRepository.getTooltips.mockResolvedValue(mockTooltips);

      await service.getTooltips(undefined, {
        sortBy: 'location',
        order: 'DESC',
      });

      expect(tooltipRepository.getTooltips).toHaveBeenCalledWith(undefined, {
        sortBy: 'location',
        order: 'DESC',
      });
    });
  });
});
