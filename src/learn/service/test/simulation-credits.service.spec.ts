import { Test, TestingModule } from '@nestjs/testing';
import { SimulationCreditsService } from '../simulation-credits.service';
import { SimulationCreditsRepository } from '../../repository/simulation-credits.repository';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { UserService } from 'src/user/service/user.service';
import { AppConfigService } from 'src/config/config.service';
import { BadRequestException } from '@nestjs/common';

describe('SimulationCreditsService', () => {
  let service: SimulationCreditsService;
  let mockSimulationCreditsRepository: any;
  let mockPermissionValidator: any;
  let mockUserService: any;
  let mockConfigService: any;

  const mockCredits = {
    id: 1,
    userId: 1,
    creditLimit: 100,
    consumedCredits: 25,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockSimulationCreditsRepository = {
      findByUserId: jest.fn(),
      createOrUpdate: jest.fn(),
      consumeCredits: jest.fn(),
    };

    mockPermissionValidator = {
      validatePermissions: jest.fn(),
    };

    mockUserService = {
      get: jest.fn(),
      isValidUser: jest.fn(),
    };

    mockConfigService = {
      simulationCredits: {
        lifespanSecondsPerCredit: 60,
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimulationCreditsService,
        {
          provide: SimulationCreditsRepository,
          useValue: mockSimulationCreditsRepository,
        },
        { provide: PermissionValidator, useValue: mockPermissionValidator },
        { provide: UserService, useValue: mockUserService },
        { provide: AppConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<SimulationCreditsService>(SimulationCreditsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSimulationCredits', () => {
    it('should return credits for token user when no userId provided', async () => {
      const tokenUserId = 1;
      mockPermissionValidator.validatePermissions.mockResolvedValue(false);
      mockSimulationCreditsRepository.findByUserId.mockResolvedValue(
        mockCredits,
      );

      const result = await service.getSimulationCredits(
        tokenUserId,
        tokenUserId,
      );

      expect(result).toEqual({
        creditLimit: 100,
        consumedCredits: 25,
        secondsAllowedPerCredit: 60,
      });
      expect(mockUserService.isValidUser).not.toHaveBeenCalled();
    });

    it('should return credits for specified user when system access granted', async () => {
      const tokenUserId = 1;
      const targetUserId = 2;
      mockPermissionValidator.validatePermissions.mockResolvedValue(true);
      mockUserService.isValidUser.mockResolvedValue(true);
      mockSimulationCreditsRepository.findByUserId.mockResolvedValue(
        mockCredits,
      );

      const result = await service.getSimulationCredits(
        tokenUserId,
        targetUserId,
      );

      expect(result).toEqual({
        creditLimit: 100,
        consumedCredits: 25,
        secondsAllowedPerCredit: 60,
      });
      expect(mockUserService.isValidUser).toHaveBeenCalledWith(targetUserId);
    });

    it('should throw error when user not found', async () => {
      const tokenUserId = 1;
      const targetUserId = 2;
      mockPermissionValidator.validatePermissions.mockResolvedValue(true);
      mockUserService.isValidUser.mockResolvedValue(false);

      await expect(
        service.getSimulationCredits(tokenUserId, targetUserId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return default values when no credits found', async () => {
      const tokenUserId = 1;
      mockPermissionValidator.validatePermissions.mockResolvedValue(false);
      mockSimulationCreditsRepository.findByUserId.mockResolvedValue(null);

      const result = await service.getSimulationCredits(
        tokenUserId,
        tokenUserId,
      );

      expect(result).toEqual({
        creditLimit: 0,
        consumedCredits: 0,
        secondsAllowedPerCredit: 60,
      });
    });
  });

  describe('updateSimulationCredits', () => {
    it('should update credits successfully', async () => {
      const updateDto = { userId: 1, creditLimit: 150 };
      mockPermissionValidator.validatePermissions.mockResolvedValue(true);
      mockSimulationCreditsRepository.findByUserId.mockResolvedValue(
        mockCredits,
      );
      mockSimulationCreditsRepository.createOrUpdate.mockResolvedValue({
        ...mockCredits,
        creditLimit: 150,
      });

      const result = await service.updateSimulationCredits(updateDto);

      expect(result).toEqual({ success: true });
      expect(
        mockSimulationCreditsRepository.createOrUpdate,
      ).toHaveBeenCalledWith(1, 150);
    });

    it('should throw error when user not found', async () => {
      const updateDto = { userId: 999, creditLimit: 150 };
      mockPermissionValidator.validatePermissions.mockResolvedValue(false);

      await expect(service.updateSimulationCredits(updateDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw error when credit limit is less than consumed credits', async () => {
      const updateDto = { userId: 1, creditLimit: 10 };
      mockPermissionValidator.validatePermissions.mockResolvedValue(true);
      mockSimulationCreditsRepository.findByUserId.mockResolvedValue(
        mockCredits,
      );

      await expect(service.updateSimulationCredits(updateDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('consumeCredits', () => {
    it('should consume credits successfully', async () => {
      mockSimulationCreditsRepository.consumeCredits.mockResolvedValue(true);

      const result = await service.consumeCredits(1, 10);

      expect(result).toBe(true);
      expect(
        mockSimulationCreditsRepository.consumeCredits,
      ).toHaveBeenCalledWith(1, 10);
    });

    it('should throw error when credits to consume is invalid', async () => {
      await expect(service.consumeCredits(1, 0)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw error when insufficient credits', async () => {
      mockSimulationCreditsRepository.consumeCredits.mockResolvedValue(false);

      await expect(service.consumeCredits(1, 10)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
