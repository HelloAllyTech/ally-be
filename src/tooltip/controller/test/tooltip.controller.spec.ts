import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { TooltipController } from '../tooltip.controller';
import { TooltipService } from '../../service/tooltip.service';
import { Tooltip } from '../../entity/tooltip.entity';
import { CreateTooltipDto } from '../../dto/create-tooltip.dto';
import { UpdateTooltipDto } from '../../dto/update-tooltip.dto';
import { NotFoundException } from 'src/exception/custom.exception';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { UserService } from 'src/user/service/user.service';
import { AppConfigService } from 'src/config/config.service';

describe('TooltipController', () => {
  let controller: TooltipController;
  let tooltipService: jest.Mocked<TooltipService>;

  const mockTooltip: Tooltip = {
    id: 'tooltip-uuid-1',
    location: 'login_button',
    tipText: 'Click here to log in',
    active: true,
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as Tooltip;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TooltipController],
      providers: [
        {
          provide: TooltipService,
          useValue: {
            getTooltips: jest.fn(),
            createTooltip: jest.fn(),
            updateTooltip: jest.fn(),
            getActiveTooltips: jest.fn(),
          },
        },
        {
          provide: PermissionsService,
          useValue: { checkPermission: jest.fn() },
        },
        {
          provide: UserService,
          useValue: { get: jest.fn() },
        },
        {
          provide: AppConfigService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<TooltipController>(TooltipController);
    tooltipService = module.get(TooltipService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getActiveTooltips', () => {
    it('should return active tooltips from service', async () => {
      const activeTooltips = [mockTooltip];
      tooltipService.getActiveTooltips.mockResolvedValue(activeTooltips);

      const result = await controller.getActiveTooltips();

      expect(tooltipService.getActiveTooltips).toHaveBeenCalled();
      expect(result).toEqual(activeTooltips);
    });

    it('should return empty array when no active tooltips exist', async () => {
      tooltipService.getActiveTooltips.mockResolvedValue([]);

      const result = await controller.getActiveTooltips();

      expect(result).toEqual([]);
    });
  });

  describe('getTooltips', () => {
    const mockTooltips = [mockTooltip];

    it('should return all tooltips with no filters', async () => {
      tooltipService.getTooltips.mockResolvedValue(mockTooltips);

      const result = await controller.getTooltips(
        undefined,
        30,
        0,
        undefined,
        undefined,
      );

      expect(tooltipService.getTooltips).toHaveBeenCalledWith(undefined, {
        limit: 30,
        offset: 0,
        sortBy: undefined,
        order: undefined,
      });
      expect(result).toEqual(mockTooltips);
    });

    it('should pass search term to service', async () => {
      tooltipService.getTooltips.mockResolvedValue(mockTooltips);

      await controller.getTooltips('login', 30, 0, undefined, undefined);

      expect(tooltipService.getTooltips).toHaveBeenCalledWith('login', {
        limit: 30,
        offset: 0,
        sortBy: undefined,
        order: undefined,
      });
    });

    it('should pass sorting options to service', async () => {
      tooltipService.getTooltips.mockResolvedValue(mockTooltips);

      await controller.getTooltips(undefined, 30, 0, 'location', 'ASC');

      expect(tooltipService.getTooltips).toHaveBeenCalledWith(undefined, {
        limit: 30,
        offset: 0,
        sortBy: 'location',
        order: 'ASC',
      });
    });

    it('should return empty array when no tooltips exist', async () => {
      tooltipService.getTooltips.mockResolvedValue([]);

      const result = await controller.getTooltips(
        undefined,
        30,
        0,
        undefined,
        undefined,
      );

      expect(result).toEqual([]);
    });

    it('should pass pagination options to service', async () => {
      tooltipService.getTooltips.mockResolvedValue(mockTooltips);

      await controller.getTooltips(undefined, 10, 20, undefined, undefined);

      expect(tooltipService.getTooltips).toHaveBeenCalledWith(undefined, {
        limit: 10,
        offset: 20,
        sortBy: undefined,
        order: undefined,
      });
    });
  });

  describe('createTooltip', () => {
    const createDto: CreateTooltipDto = {
      location: 'login_button',
      tipText: 'Click here to log in',
      active: false,
    };

    it('should create and return a tooltip', async () => {
      tooltipService.createTooltip.mockResolvedValue(mockTooltip);

      const result = await controller.createTooltip(createDto);

      expect(tooltipService.createTooltip).toHaveBeenCalledWith(createDto);
      expect(result).toEqual(mockTooltip);
    });

    it('should propagate ConflictException from service', async () => {
      tooltipService.createTooltip.mockRejectedValue(
        new ConflictException('already exists'),
      );

      await expect(controller.createTooltip(createDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('updateTooltip', () => {
    const tooltipId = 'tooltip-uuid-1';
    const updateDto: UpdateTooltipDto = { tipText: 'Updated text' };

    it('should return true when update succeeds', async () => {
      tooltipService.updateTooltip.mockResolvedValue(true);

      const result = await controller.updateTooltip(tooltipId, updateDto);

      expect(tooltipService.updateTooltip).toHaveBeenCalledWith(
        tooltipId,
        updateDto,
      );
      expect(result).toBe(true);
    });

    it('should propagate NotFoundException from service', async () => {
      tooltipService.updateTooltip.mockRejectedValue(
        new NotFoundException('Tooltip not found'),
      );

      await expect(
        controller.updateTooltip(tooltipId, updateDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate ConflictException on duplicate location', async () => {
      tooltipService.updateTooltip.mockRejectedValue(
        new ConflictException('already exists'),
      );

      await expect(
        controller.updateTooltip(tooltipId, { location: 'login_button' }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
