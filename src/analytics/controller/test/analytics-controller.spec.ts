import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsController } from '../analytics.controller';
import { AnalyticsService } from '../../service/analytics.service';
import { CohortAnalyticsService } from '../../service/cohort-analytics.service';
import { UsageLevelAnalyticsService } from '../../service/usage-level-analytics.service';
import { CertificationAnalyticsService } from '../../service/certification-analytics.service';
import { RoleplayVolumeAnalyticsService } from '../../service/roleplay-volume-analytics.service';
import { RoadmapDeliveryAnalyticsService } from '../../service/roadmap-delivery-analytics.service';
import { HighlightsAnalyticsService } from '../../service/highlights-analytics.service';
import { PlatformAnalyticsService } from '../../service/platform-analytics.service';
import { ScribeAnalyticsService } from '../../service/scribe-analytics.service';
import { LanguageJudgeService } from '../../service/language-judge.service';
import { FillerJudgeService } from '../../service/filler-judge.service';
import { FillerAnalyticsService } from '../../service/filler-analytics.service';
import { LanguageAnalyticsService } from '../../service/language-analytics.service';
import { GlossaryEffectAnalyticsService } from '../../service/glossary-effect-analytics.service';
import { WeakMetricsAnalyticsService } from '../../service/weak-metrics-analytics.service';
import { FeedbackGroundednessJudgeService } from '../../service/feedback-groundedness-judge.service';
import { ActivationAnalyticsService } from '../../service/activation-analytics.service';
import { CompletionRateAnalyticsService } from '../../service/completion-rate-analytics.service';
import { LanguageMixAnalyticsService } from '../../service/language-mix-analytics.service';
import { SkillGrowthAnalyticsService } from '../../service/skill-growth-analytics.service';
import { QualityDistributionAnalyticsService } from '../../service/quality-distribution-analytics.service';
import { CompetencyMapAnalyticsService } from '../../service/competency-map-analytics.service';
import { TrackDropoffAnalyticsService } from '../../service/track-dropoff-analytics.service';
import { CoachingLoopAnalyticsService } from '../../service/coaching-loop-analytics.service';
import { OrgHealthAnalyticsService } from '../../service/org-health-analytics.service';
import { OrgSessionDistributionAnalyticsService } from '../../service/org-session-distribution-analytics.service';
import { LearnerKpisAnalyticsService } from '../../service/learner-kpis-analytics.service';
import { ScenarioUsageAnalyticsService } from '../../service/scenario-usage-analytics.service';
import { ScribeAdoptionAnalyticsService } from '../../service/scribe-adoption-analytics.service';
import { UsageLadderAnalyticsService } from '../../service/usage-ladder-analytics.service';
import { PracticeDepthAnalyticsService } from '../../service/practice-depth-analytics.service';
import { OrgEngagementAnalyticsService } from '../../service/org-engagement-analytics.service';
import { RoleplayCostAnalyticsService } from '../../service/roleplay-cost-analytics.service';
import { QualitySentimentAnalyticsService } from '../../service/quality-sentiment-analytics.service';
import { ChartPreferenceService } from '../../service/chart-preference.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { FeatureToggleGuard } from '../../../auth/guards/feature-toggle.guard';
import { PermissionsService } from '../../../authorization/service/permissions.service';
import { FeatureToggleService } from '../../../authorization/service/feature-toggle.service';
import { PERMISSIONS } from '../../../authorization/constants/permissions.constants';
import { UserService } from '../../../user/service/user.service';
import {
  CreateDashboardDto,
  CreateDashboardResponseDto,
  DashboardIdParamDto,
  CounselorStatsQueryDto,
  UpdateDashboardDto,
  DashboardResponseDTO,
} from '../../dto/analytics.dto';
import { AnalyticsTypeEnum } from '../../constants/analytics.constants';
import { DashboardWithGroupId } from '../../type/dashboard.data.type';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let analyticsService: jest.Mocked<AnalyticsService>;

  const mockDashboard: DashboardWithGroupId = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Test Dashboard',
    externalId: 'dashboard-123',
    groupId: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    analyticsType: AnalyticsTypeEnum.CALL_LOG_ANALYTICS,
  };

  const mockDashboardUrl = {
    url: 'https://metabase.example.com/embed/dashboard/token123',
  };

  const mockCounselorStats = {
    counselorName: 'John Doe',
    counselorListeningDuration: 1800.5,
    counselorSharingDuration: 600.25,
    counselorSharingPercentage: 25,
  };

  beforeEach(async () => {
    const mockAnalyticsService = {
      getDashboardUrl: jest.fn(),
      refreshDashboardUrl: jest.fn(),
      createDashboard: jest.fn(),
      getDashboards: jest.fn(),
      getAllDashboards: jest.fn(),
      getCounselorStats: jest.fn(),
      updateDashboard: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        {
          provide: AnalyticsService,
          useValue: mockAnalyticsService,
        },
        {
          provide: HighlightsAnalyticsService,
          useValue: { getHighlights: jest.fn() },
        },
        {
          provide: CohortAnalyticsService,
          useValue: { getCohortRetention: jest.fn() },
        },
        {
          provide: UsageLevelAnalyticsService,
          useValue: { getUsageLevels: jest.fn() },
        },
        {
          provide: CertificationAnalyticsService,
          useValue: { getCertification: jest.fn() },
        },
        {
          provide: RoleplayVolumeAnalyticsService,
          useValue: { getRoleplayVolume: jest.fn() },
        },
        {
          provide: RoadmapDeliveryAnalyticsService,
          useValue: { getRoadmapDelivery: jest.fn() },
        },
        {
          provide: PlatformAnalyticsService,
          useValue: { getOverview: jest.fn() },
        },
        {
          provide: ScribeAnalyticsService,
          useValue: { getOverview: jest.fn(), getSummaryFailures: jest.fn() },
        },
        {
          provide: LanguageJudgeService,
          useValue: { startBackfill: jest.fn(), getJob: jest.fn() },
        },
        {
          provide: FillerJudgeService,
          useValue: { startBackfill: jest.fn(), getJob: jest.fn() },
        },
        {
          provide: FillerAnalyticsService,
          useValue: { getFillerQuality: jest.fn() },
        },
        {
          provide: LanguageAnalyticsService,
          useValue: { getLanguageQuality: jest.fn() },
        },
        {
          provide: GlossaryEffectAnalyticsService,
          useValue: { getGlossaryEffect: jest.fn() },
        },
        {
          provide: WeakMetricsAnalyticsService,
          useValue: { getWeakMetrics: jest.fn() },
        },
        {
          provide: FeedbackGroundednessJudgeService,
          useValue: { startBackfill: jest.fn(), getJob: jest.fn() },
        },
        // Testing-tab services. Stubbed rather than exercised here: this suite
        // covers the dashboard/permission surface, and each of these has its own
        // service spec asserting the rules that matter (suppression floors,
        // null-over-zero-denominator rates, residual derivation).
        {
          provide: ActivationAnalyticsService,
          useValue: { getActivation: jest.fn() },
        },
        {
          provide: CompletionRateAnalyticsService,
          useValue: { getCompletionRate: jest.fn() },
        },
        {
          provide: LanguageMixAnalyticsService,
          useValue: { getLanguageMix: jest.fn() },
        },
        {
          provide: SkillGrowthAnalyticsService,
          useValue: { getSkillGrowth: jest.fn() },
        },
        {
          provide: QualityDistributionAnalyticsService,
          useValue: { getQualityDistribution: jest.fn() },
        },
        {
          provide: CompetencyMapAnalyticsService,
          useValue: { getCompetencyMap: jest.fn() },
        },
        {
          provide: TrackDropoffAnalyticsService,
          useValue: { getTrackDropoff: jest.fn() },
        },
        {
          provide: CoachingLoopAnalyticsService,
          useValue: { getCoachingLoop: jest.fn() },
        },
        {
          provide: OrgHealthAnalyticsService,
          useValue: { getOrgHealth: jest.fn() },
        },
        {
          provide: OrgSessionDistributionAnalyticsService,
          useValue: { getDistribution: jest.fn() },
        },
        {
          provide: LearnerKpisAnalyticsService,
          useValue: { getLearnerKpis: jest.fn() },
        },
        {
          provide: ScenarioUsageAnalyticsService,
          useValue: { getScenarioUsage: jest.fn() },
        },
        {
          provide: ScribeAdoptionAnalyticsService,
          useValue: { getScribeAdoption: jest.fn() },
        },
        {
          provide: UsageLadderAnalyticsService,
          useValue: { getUsageLadder: jest.fn() },
        },
        {
          provide: PracticeDepthAnalyticsService,
          useValue: {
            getStickiness: jest.fn(),
            getQualifiedSessions: jest.fn(),
          },
        },
        {
          provide: OrgEngagementAnalyticsService,
          useValue: { getOrgEngagement: jest.fn() },
        },
        {
          provide: RoleplayCostAnalyticsService,
          useValue: { getRoleplayCost: jest.fn() },
        },
        {
          provide: QualitySentimentAnalyticsService,
          useValue: { getQualitySentiment: jest.fn() },
        },
        {
          provide: ChartPreferenceService,
          useValue: { getForUser: jest.fn(), saveForUser: jest.fn() },
        },
        {
          provide: Reflector,
          useValue: {
            get: jest.fn(),
            getAllAndOverride: jest.fn(),
            getAllAndMerge: jest.fn(),
          },
        },
        {
          provide: PermissionsService,
          useValue: {
            getUserRoles: jest.fn().mockResolvedValue(['SUPER_ADMIN']),
            getUserPermissions: jest
              .fn()
              .mockResolvedValue([
                PERMISSIONS.EDIT_ANALYTICS_DASHBOARD,
                PERMISSIONS.VIEW_ANALYTICS_DASHBOARD,
                PERMISSIONS.VIEW_ANALYTICS_DASHBOARD_URL,
              ]),
          },
        },
        {
          provide: UserService,
          useValue: {
            getTermsAndAgreementApproval: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: RolesGuard,
          useValue: {
            canActivate: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: PermissionsGuard,
          useValue: {
            canActivate: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: JwtAuthGuard,
          useValue: {
            canActivate: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: FeatureToggleService,
          useValue: {
            hasToggle: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue({
        canActivate: jest.fn().mockResolvedValue(true),
      })
      .overrideGuard(PermissionsGuard)
      .useValue({
        canActivate: jest.fn().mockResolvedValue(true),
      })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: jest.fn().mockResolvedValue(true),
      })
      .overrideGuard(FeatureToggleGuard)
      .useValue({
        canActivate: jest.fn().mockResolvedValue(true),
      })
      .compile();

    controller = module.get<AnalyticsController>(AnalyticsController);
    analyticsService = module.get(AnalyticsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getDashboardUrl', () => {
    it('should return dashboard URL successfully', async () => {
      const externalId = 'dashboard-123';
      const params: DashboardIdParamDto = { externalId };

      analyticsService.getDashboardUrl.mockResolvedValue(mockDashboardUrl);

      const result = await controller.getDashboardUrl(params);

      expect(result).toEqual(mockDashboardUrl);
      expect(analyticsService.getDashboardUrl).toHaveBeenCalledTimes(1);
      expect(analyticsService.getDashboardUrl).toHaveBeenCalledWith(externalId);
    });

    it('should throw NotFoundException when dashboard not found', async () => {
      const externalId = 'nonexistent-dashboard';
      const params: DashboardIdParamDto = { externalId };

      analyticsService.getDashboardUrl.mockRejectedValue(
        new NotFoundException('Dashboard not found'),
      );

      await expect(controller.getDashboardUrl(params)).rejects.toThrow(
        new NotFoundException('Dashboard not found'),
      );

      expect(analyticsService.getDashboardUrl).toHaveBeenCalledTimes(1);
      expect(analyticsService.getDashboardUrl).toHaveBeenCalledWith(externalId);
    });

    it('should handle service errors gracefully', async () => {
      const externalId = 'dashboard-123';
      const params: DashboardIdParamDto = { externalId };
      const error = new Error('Service error');

      analyticsService.getDashboardUrl.mockRejectedValue(error);

      await expect(controller.getDashboardUrl(params)).rejects.toThrow(error);

      expect(analyticsService.getDashboardUrl).toHaveBeenCalledTimes(1);
      expect(analyticsService.getDashboardUrl).toHaveBeenCalledWith(externalId);
    });
  });

  describe('refreshDashboardUrl', () => {
    it('should refresh dashboard URL successfully', async () => {
      const externalId = 'dashboard-123';
      const params: DashboardIdParamDto = { externalId };
      const refreshedUrl = {
        url: 'https://metabase.example.com/embed/dashboard/new-token',
      };

      analyticsService.refreshDashboardUrl.mockResolvedValue(refreshedUrl);

      const result = await controller.refreshDashboardUrl(params);

      expect(result).toEqual(refreshedUrl);
      expect(analyticsService.refreshDashboardUrl).toHaveBeenCalledTimes(1);
      expect(analyticsService.refreshDashboardUrl).toHaveBeenCalledWith(
        externalId,
      );
    });

    it('should handle refresh errors', async () => {
      const externalId = 'dashboard-123';
      const params: DashboardIdParamDto = { externalId };
      const error = new Error('Refresh failed');

      analyticsService.refreshDashboardUrl.mockRejectedValue(error);

      await expect(controller.refreshDashboardUrl(params)).rejects.toThrow(
        error,
      );

      expect(analyticsService.refreshDashboardUrl).toHaveBeenCalledTimes(1);
      expect(analyticsService.refreshDashboardUrl).toHaveBeenCalledWith(
        externalId,
      );
    });
  });

  describe('createDashboard', () => {
    const mockCreateResponse: CreateDashboardResponseDto = {
      id: '550e8400-e29b-41d4-a716-446655440000',
    };

    it('should create dashboard successfully', async () => {
      const createDashboardDto: CreateDashboardDto = {
        name: 'New Dashboard',
        externalId: 'new-dashboard',
        groupIds: [2],
        description: 'Test dashboard',
        tenantIds: ['tenant-123'],
        analyticsType: AnalyticsTypeEnum.CALL_LOG_ANALYTICS,
      };

      analyticsService.createDashboard.mockResolvedValue(mockCreateResponse);

      const result = await controller.createDashboard(createDashboardDto);

      expect(result).toEqual(mockCreateResponse);
      expect(analyticsService.createDashboard).toHaveBeenCalledTimes(1);
      expect(analyticsService.createDashboard).toHaveBeenCalledWith(
        createDashboardDto,
      );
    });

    it('should throw BadRequestException when dashboard already exists', async () => {
      const createDashboardDto: CreateDashboardDto = {
        name: 'New Dashboard',
        externalId: 'new-dashboard',
        groupIds: [2],
        tenantIds: ['tenant-123'],
        analyticsType: AnalyticsTypeEnum.CALL_LOG_ANALYTICS,
      };

      analyticsService.createDashboard.mockRejectedValue(
        new BadRequestException('Dashboard already exists'),
      );

      await expect(
        controller.createDashboard(createDashboardDto),
      ).rejects.toThrow(BadRequestException);

      expect(analyticsService.createDashboard).toHaveBeenCalledTimes(1);
      expect(analyticsService.createDashboard).toHaveBeenCalledWith(
        createDashboardDto,
      );
    });

    it('should handle dashboard creation errors', async () => {
      const createDashboardDto: CreateDashboardDto = {
        name: 'New Dashboard',
        externalId: 'new-dashboard',
        groupIds: [2],
        tenantIds: ['tenant-123'],
        analyticsType: AnalyticsTypeEnum.CALL_LOG_ANALYTICS,
      };
      const error = new Error('Creation failed');

      analyticsService.createDashboard.mockRejectedValue(error);

      await expect(
        controller.createDashboard(createDashboardDto),
      ).rejects.toThrow(error);

      expect(analyticsService.createDashboard).toHaveBeenCalledTimes(1);
      expect(analyticsService.createDashboard).toHaveBeenCalledWith(
        createDashboardDto,
      );
    });

    it('should create dashboard with minimal required fields', async () => {
      const createDashboardDto: CreateDashboardDto = {
        name: 'Minimal Dashboard',
        externalId: 'minimal-dashboard',
        groupIds: [1],
        tenantIds: ['tenant-123'],
        analyticsType: AnalyticsTypeEnum.CALL_LOG_ANALYTICS,
      };

      analyticsService.createDashboard.mockResolvedValue(mockCreateResponse);

      const result = await controller.createDashboard(createDashboardDto);

      expect(result).toEqual(mockCreateResponse);
      expect(analyticsService.createDashboard).toHaveBeenCalledTimes(1);
      expect(analyticsService.createDashboard).toHaveBeenCalledWith(
        createDashboardDto,
      );
    });
  });

  describe('getDashboards', () => {
    it('should return user dashboards successfully', async () => {
      const mockUser = { id: 123 };
      const mockDashboards: DashboardWithGroupId[] = [
        mockDashboard,
        {
          ...mockDashboard,
          id: '550e8400-e29b-41d4-a716-446655440001',
          groupId: 2,
          analyticsType: AnalyticsTypeEnum.ORG_ANALYTICS,
        },
      ];

      analyticsService.getDashboards.mockResolvedValue(mockDashboards);

      const result = await controller.getDashboards({ user: mockUser });

      expect(result).toEqual(mockDashboards);
      expect(analyticsService.getDashboards).toHaveBeenCalledTimes(1);
      expect(analyticsService.getDashboards).toHaveBeenCalledWith(mockUser.id);
    });

    it('should return undefined when user has no dashboards', async () => {
      const mockUser = { id: 123 };

      analyticsService.getDashboards.mockResolvedValue(undefined);

      const result = await controller.getDashboards({ user: mockUser });

      expect(result).toBeUndefined();
      expect(analyticsService.getDashboards).toHaveBeenCalledTimes(1);
      expect(analyticsService.getDashboards).toHaveBeenCalledWith(mockUser.id);
    });

    it('should return empty array when user has no groups', async () => {
      const mockUser = { id: 123 };

      analyticsService.getDashboards.mockResolvedValue([]);

      const result = await controller.getDashboards({ user: mockUser });

      expect(result).toEqual([]);
      expect(analyticsService.getDashboards).toHaveBeenCalledTimes(1);
      expect(analyticsService.getDashboards).toHaveBeenCalledWith(mockUser.id);
    });

    it('should handle service errors', async () => {
      const mockUser = { id: 123 };
      const error = new Error('Service error');

      analyticsService.getDashboards.mockRejectedValue(error);

      await expect(
        controller.getDashboards({ user: mockUser }),
      ).rejects.toThrow(error);

      expect(analyticsService.getDashboards).toHaveBeenCalledTimes(1);
      expect(analyticsService.getDashboards).toHaveBeenCalledWith(mockUser.id);
    });
  });

  describe('getAllDashboards', () => {
    const mockDashboardResponses: DashboardResponseDTO[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        externalId: 'dashboard-123',
        name: 'Test Dashboard',
        description: 'Test',
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440001',
        externalId: 'dashboard-456',
        name: 'Another Dashboard',
        description: 'Another',
      },
    ];

    it('should return all dashboards successfully', async () => {
      analyticsService.getAllDashboards.mockResolvedValue(
        mockDashboardResponses,
      );

      const result = await controller.getAllDashboards();

      expect(result).toEqual(mockDashboardResponses);
      expect(analyticsService.getAllDashboards).toHaveBeenCalledTimes(1);
      expect(analyticsService.getAllDashboards).toHaveBeenCalledWith();
    });

    it('should return empty array when no dashboards exist', async () => {
      analyticsService.getAllDashboards.mockResolvedValue([]);

      const result = await controller.getAllDashboards();

      expect(result).toEqual([]);
      expect(analyticsService.getAllDashboards).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateDashboard', () => {
    it('should update dashboard successfully', async () => {
      const dashboardId = '550e8400-e29b-41d4-a716-446655440000';
      const updateDashboardDto: UpdateDashboardDto = {
        name: 'Updated Dashboard',
        tenantIds: ['tenant-456'],
        groupIds: [1, 2],
      };

      analyticsService.updateDashboard.mockResolvedValue(undefined);

      const result = await controller.updateDashboard(
        dashboardId,
        updateDashboardDto,
      );

      expect(result).toBeUndefined();
      expect(analyticsService.updateDashboard).toHaveBeenCalledTimes(1);
      expect(analyticsService.updateDashboard).toHaveBeenCalledWith(
        dashboardId,
        updateDashboardDto,
      );
    });

    it('should throw BadRequestException when dashboard not found', async () => {
      const dashboardId = '550e8400-e29b-41d4-a716-446655440000';
      const updateDashboardDto: UpdateDashboardDto = { name: 'Updated Name' };

      analyticsService.updateDashboard.mockRejectedValue(
        new BadRequestException('Dashboard not found'),
      );

      await expect(
        controller.updateDashboard(dashboardId, updateDashboardDto),
      ).rejects.toThrow(BadRequestException);

      expect(analyticsService.updateDashboard).toHaveBeenCalledTimes(1);
      expect(analyticsService.updateDashboard).toHaveBeenCalledWith(
        dashboardId,
        updateDashboardDto,
      );
    });
  });

  describe('getCounselorStats', () => {
    it('should return counselor stats with date range', async () => {
      const mockUser = { id: 123 };
      const queryParams: CounselorStatsQueryDto = {
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      };

      analyticsService.getCounselorStats.mockResolvedValue(mockCounselorStats);

      const result = await controller.getCounselorStats(queryParams, {
        user: mockUser,
      });

      expect(result).toEqual(mockCounselorStats);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledTimes(1);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledWith(
        queryParams,
        mockUser.id,
      );
    });

    it('should return counselor stats with only start date', async () => {
      const mockUser = { id: 123 };
      const queryParams: CounselorStatsQueryDto = {
        startDate: '2024-01-01',
      };

      analyticsService.getCounselorStats.mockResolvedValue(mockCounselorStats);

      const result = await controller.getCounselorStats(queryParams, {
        user: mockUser,
      });

      expect(result).toEqual(mockCounselorStats);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledTimes(1);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledWith(
        queryParams,
        mockUser.id,
      );
    });

    it('should return counselor stats with only end date', async () => {
      const mockUser = { id: 123 };
      const queryParams: CounselorStatsQueryDto = {
        endDate: '2024-01-31',
      };

      analyticsService.getCounselorStats.mockResolvedValue(mockCounselorStats);

      const result = await controller.getCounselorStats(queryParams, {
        user: mockUser,
      });

      expect(result).toEqual(mockCounselorStats);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledTimes(1);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledWith(
        queryParams,
        mockUser.id,
      );
    });

    it('should return counselor stats without date filters', async () => {
      const mockUser = { id: 123 };
      const queryParams: CounselorStatsQueryDto = {};

      analyticsService.getCounselorStats.mockResolvedValue(mockCounselorStats);

      const result = await controller.getCounselorStats(queryParams, {
        user: mockUser,
      });

      expect(result).toEqual(mockCounselorStats);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledTimes(1);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledWith(
        queryParams,
        mockUser.id,
      );
    });

    it('should handle counselor stats service errors', async () => {
      const mockUser = { id: 123 };
      const queryParams: CounselorStatsQueryDto = {};
      const error = new Error('Database error');

      analyticsService.getCounselorStats.mockRejectedValue(error);

      await expect(
        controller.getCounselorStats(queryParams, { user: mockUser }),
      ).rejects.toThrow(error);

      expect(analyticsService.getCounselorStats).toHaveBeenCalledTimes(1);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledWith(
        queryParams,
        mockUser.id,
      );
    });

    it('should handle empty counselor stats result', async () => {
      const mockUser = { id: 123 };
      const queryParams: CounselorStatsQueryDto = {};
      const emptyStats = {
        counselorName: '',
        counselorListeningDuration: 0,
        counselorSharingDuration: 0,
        counselorSharingPercentage: 0,
      };

      analyticsService.getCounselorStats.mockResolvedValue(emptyStats);

      const result = await controller.getCounselorStats(queryParams, {
        user: mockUser,
      });

      expect(result).toEqual(emptyStats);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledTimes(1);
      expect(analyticsService.getCounselorStats).toHaveBeenCalledWith(
        queryParams,
        mockUser.id,
      );
    });
  });
});
