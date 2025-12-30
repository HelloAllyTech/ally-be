import { Test, TestingModule } from '@nestjs/testing';
import { SimulationCreditsController } from '../simulation-credits.controller';
import { SimulationCreditsService } from '../../service/simulation-credits.service';
import { TokenUser } from 'src/auth/type/auth.types';
import { GetSimulationCreditsDto } from '../../dto/get-simulation-credits.dto';
import { UpdateSimulationCreditsDto } from '../../dto/update-simulation-credits.dto';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { UserService } from 'src/user/service/user.service';
import { AppConfigService } from 'src/config/config.service';

describe('SimulationCreditsController', () => {
  let controller: SimulationCreditsController;
  let mockSimulationCreditsService: any;

  const mockTokenUser: TokenUser = {
    id: 1,
    username: 'test@example.com',
    tenantId: 'test-tenant',
  };

  const mockCreditsResponse = {
    creditLimit: 100,
    consumedCredits: 25,
    secondsAllowedPerCredit: 60,
  };

  beforeEach(async () => {
    mockSimulationCreditsService = {
      getSimulationCredits: jest.fn(),
      updateSimulationCredits: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SimulationCreditsController],
      providers: [
        {
          provide: SimulationCreditsService,
          useValue: mockSimulationCreditsService,
        },
        { provide: Reflector, useValue: {} },
        {
          provide: PermissionsService,
          useValue: { getUserPermissions: jest.fn() },
        },
        {
          provide: UserService,
          useValue: {
            getTermsAndAgreementApproval: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: AppConfigService,
          useValue: {
            featureFlag: {
              termsAndAgreement: false,
            },
          },
        },
      ],
    }).compile();

    controller = module.get<SimulationCreditsController>(
      SimulationCreditsController,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSimulationCredits', () => {
    it('should return simulation credits for token user', async () => {
      const query: GetSimulationCreditsDto = {};
      mockSimulationCreditsService.getSimulationCredits.mockResolvedValue(
        mockCreditsResponse,
      );

      const result = await controller.getSimulationCredits(
        mockTokenUser,
        query,
      );

      expect(result).toEqual(mockCreditsResponse);
      expect(
        mockSimulationCreditsService.getSimulationCredits,
      ).toHaveBeenCalledWith(1, undefined);
    });

    it('should return simulation credits for specified user', async () => {
      const query: GetSimulationCreditsDto = { userId: 2 };
      mockSimulationCreditsService.getSimulationCredits.mockResolvedValue(
        mockCreditsResponse,
      );

      const result = await controller.getSimulationCredits(
        mockTokenUser,
        query,
      );

      expect(result).toEqual(mockCreditsResponse);
      expect(
        mockSimulationCreditsService.getSimulationCredits,
      ).toHaveBeenCalledWith(1, 2);
    });
  });

  describe('updateSimulationCredits', () => {
    it('should update simulation credits', async () => {
      const updateDto: UpdateSimulationCreditsDto = {
        userId: 1,
        creditLimit: 150,
      };
      const expectedResponse = true;
      mockSimulationCreditsService.updateSimulationCredits.mockResolvedValue(
        expectedResponse,
      );

      const result = await controller.updateSimulationCredits(updateDto);

      expect(result).toEqual(expectedResponse);
      expect(
        mockSimulationCreditsService.updateSimulationCredits,
      ).toHaveBeenCalledWith(updateDto);
    });
  });
});
