import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TooltipController } from '../tooltip.controller';
import { TooltipService } from '../../service/tooltip.service';
import { CreateTooltipDto } from '../../dto/create-tooltip.dto';
import { UpdateTooltipDto } from '../../dto/update-tooltip.dto';
import { Tooltip } from '../../entity/tooltip.entity';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { UserService } from 'src/user/service/user.service';
import { AppConfigService } from 'src/config/config.service';
import { SortOrder } from 'src/common/type/common.type';

describe('TooltipController', () => {
  let controller: TooltipController;
  let tooltipService: jest.Mocked<TooltipService>;

  const mockTooltip: Tooltip = {
    id: 'tooltip-uuid-1',
    location: 'Login Button',
    tipText: 'Click here to log in',
    icon: '😀',
    active: true,
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as Tooltip;

  const mockTooltips: Tooltip[] = [
    mockTooltip,
    {
      id: 'tooltip-uuid-2',
      location: 'Profile Icon',
      tipText: 'View your profile',
      icon: '',
      active: false,
      createdBy: 1,
      updatedBy: 1,
      createdAt: new Date('2026-01-02'),
      updatedAt: new Date('2026-01-02'),
    } as Tooltip,
  ];

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
    tooltipService = module.get<TooltipService>(
      TooltipService,
    ) as jest.Mocked<TooltipService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getTooltips', () => {
    it('should return all tooltips with default order ASC', async () => {
      tooltipService.getTooltips.mockResolvedValue(mockTooltips);

      const result = await controller.getTooltips();

      expect(tooltipService.getTooltips).toHaveBeenCalledWith(undefined, {
        limit: undefined,
        offset: undefined,
        sortBy: undefined,
        order: SortOrder.ASC,
      });
      expect(result).toEqual(mockTooltips);
    });

    it('should return tooltips with search filter', async () => {
      const filtered = [mockTooltip];
      tooltipService.getTooltips.mockResolvedValue(filtered);

      const result = await controller.getTooltips(
        undefined,
        undefined,
        'login',
      );

      expect(tooltipService.getTooltips).toHaveBeenCalledWith('login', {
        limit: undefined,
        offset: undefined,
        sortBy: undefined,
        order: SortOrder.ASC,
      });
      expect(result).toEqual(filtered);
    });

    it('should return tooltips with pagination', async () => {
      tooltipService.getTooltips.mockResolvedValue([mockTooltip]);

      const result = await controller.getTooltips(10, 0);

      expect(tooltipService.getTooltips).toHaveBeenCalledWith(undefined, {
        limit: 10,
        offset: 0,
        sortBy: undefined,
        order: SortOrder.ASC,
      });
      expect(result).toEqual([mockTooltip]);
    });

    it('should return tooltips sorted by location in DESC order', async () => {
      const sorted = [mockTooltips[1], mockTooltips[0]];
      tooltipService.getTooltips.mockResolvedValue(sorted);

      const result = await controller.getTooltips(
        undefined,
        undefined,
        undefined,
        'location',
        SortOrder.DESC,
      );

      expect(tooltipService.getTooltips).toHaveBeenCalledWith(undefined, {
        limit: undefined,
        offset: undefined,
        sortBy: 'location',
        order: SortOrder.DESC,
      });
      expect(result).toEqual(sorted);
    });

    it('should return empty array when no tooltips match search', async () => {
      tooltipService.getTooltips.mockResolvedValue([]);

      const result = await controller.getTooltips(
        undefined,
        undefined,
        'nonexistent',
      );

      expect(result).toEqual([]);
    });

    it('should propagate service errors', async () => {
      tooltipService.getTooltips.mockRejectedValue(new Error('Database error'));

      await expect(controller.getTooltips()).rejects.toThrow('Database error');
    });
  });

  describe('createTooltip', () => {
    const createDto: CreateTooltipDto = {
      location: 'Login Button',
      tipText: 'Click here to log in',
      icon: '😀',
      active: false,
    };

    it('should create and return the new tooltip', async () => {
      tooltipService.createTooltip.mockResolvedValue(mockTooltip);

      const result = await controller.createTooltip(createDto);

      expect(tooltipService.createTooltip).toHaveBeenCalledWith(createDto);
      expect(result).toEqual(mockTooltip);
    });

    it('should propagate ConflictException when location already exists', async () => {
      tooltipService.createTooltip.mockRejectedValue(
        new ConflictException(
          'A tooltip for location "Login Button" already exists',
        ),
      );

      await expect(controller.createTooltip(createDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('updateTooltip', () => {
    const tooltipId = 'tooltip-uuid-1';
    const updateDto: UpdateTooltipDto = {
      tipText: 'Updated tip text',
      active: false,
    };

    it('should update and return true on success', async () => {
      tooltipService.updateTooltip.mockResolvedValue(true);

      const result = await controller.updateTooltip(tooltipId, updateDto);

      expect(tooltipService.updateTooltip).toHaveBeenCalledWith(
        tooltipId,
        updateDto,
      );
      expect(result).toBe(true);
    });

    it('should propagate NotFoundException when tooltip does not exist', async () => {
      tooltipService.updateTooltip.mockRejectedValue(
        new NotFoundException('Tooltip not found'),
      );

      await expect(
        controller.updateTooltip('nonexistent-id', updateDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate ConflictException on duplicate location during update', async () => {
      tooltipService.updateTooltip.mockRejectedValue(
        new ConflictException(
          'A tooltip for location "Login Button" already exists',
        ),
      );

      await expect(
        controller.updateTooltip(tooltipId, { location: 'Login Button' }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
