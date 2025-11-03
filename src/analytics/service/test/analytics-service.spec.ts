import { Dashboard } from 'src/common/entities/dashboard.entity';
import { AnalyticsService } from '../analytics.service';
import { In, Repository } from 'typeorm';
import { Chat } from 'src/common/entities/chat.entity';
import { AnalyticsInterface } from 'src/analytics/interface/analytics.interface';
import { GroupService } from 'src/authorization/service/group.service';
import { NotFoundException } from '@nestjs/common';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { AnalyticsUtil } from 'src/analytics/util/analytics.util';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CreateDashboardDto } from '../../dto/analytics.dto';

// Mock the static classes at the top level
jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getTenantId: jest.fn(),
    getUserId: jest.fn(),
  },
}));

jest.mock('src/analytics/util/analytics.util', () => ({
  AnalyticsUtil: {
    generateParamList: jest.fn(),
  },
}));

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let dashboardRepository: jest.Mocked<Repository<Dashboard>>;
  let chatRepository: jest.Mocked<Repository<Chat>>;
  let analyticsInterface: jest.Mocked<AnalyticsInterface>;
  let groupService: jest.Mocked<GroupService>;
  let mockQueryBuilder: any;

  const mockTenantId = 'tenant-23';
  const mockUserId = 123;
  const mockDashboard = {
    id: 1,
    externalId: 'dashboard-123',
    groupId: 1,
    tenantId: mockTenantId,
    data: {
      params: ['organization_id', 'user_id'],
    },
  } as unknown as Dashboard;

  beforeEach(async () => {
    const mockAnalyticsInterface = {
      getDashboardUrl: jest.fn(),
      refreshDashboardUrl: jest.fn(),
    };
    const mockDashboardRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };
    const mockChatRepo = {
      createQueryBuilder: jest.fn(),
    };
    const mockGroupService = {
      getUserGroups: jest.fn(),
      getUserRolesByUserId: jest.fn(),
    };
    mockQueryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawOne: jest.fn(),
    };

    // Now you can use mockReturnValue since the classes are mocked
    (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
    (ExecutionManager.getUserId as jest.Mock).mockReturnValue(mockUserId);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: 'AnalyticsInterface',
          useValue: mockAnalyticsInterface,
        },
        {
          provide: getRepositoryToken(Dashboard),
          useValue: mockDashboardRepo,
        },
        {
          provide: getRepositoryToken(Chat),
          useValue: mockChatRepo,
        },
        {
          provide: GroupService,
          useValue: mockGroupService,
        },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    analyticsInterface = module.get('AnalyticsInterface');
    dashboardRepository = module.get(getRepositoryToken(Dashboard));
    chatRepository = module.get(getRepositoryToken(Chat));
    groupService = module.get(GroupService);

    chatRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Refresh dashboard url
  describe('refreshDashboardUrl', () => {
    it('should handle errors fom analytics interface', () => {
      const dashboardId = 'dashboard-123';
      const error = new Error('External service error');

      analyticsInterface.refreshDashboardUrl.mockRejectedValue(error);

      expect(service.refreshDashboardUrl(dashboardId)).rejects.toThrow(
        'External service error',
      );
      expect(analyticsInterface.refreshDashboardUrl).toHaveBeenCalledTimes(1);
      expect(analyticsInterface.refreshDashboardUrl).toHaveBeenCalledWith(
        dashboardId,
      );
    });
    it('should successfully refresh dashboard URL', async () => {
      // mock data
      const dashboardId = 'dashboard-123';
      const expectedUrl = 'https://analytics.com/refresh/dashboard-123';
      // mocking analyticsinterface to return expected url
      analyticsInterface.refreshDashboardUrl.mockResolvedValue(expectedUrl);
      const result = await service.refreshDashboardUrl(dashboardId);

      expect(result).toEqual({ url: expectedUrl });

      expect(analyticsInterface.refreshDashboardUrl).toHaveBeenCalledTimes(1);
      expect(analyticsInterface.refreshDashboardUrl).toHaveBeenCalledWith(
        dashboardId,
      );
    });
  });

  describe('getDashboardUrl', () => {
    it('should throw NotFoundException when dashboard not found', async () => {
      const dashboardId = 'nonexistent-dashboard';

      dashboardRepository.findOne.mockResolvedValue(null);

      await expect(service.getDashboardUrl(dashboardId)).rejects.toThrow(
        new NotFoundException('Dashboard not found'),
      );

      expect(dashboardRepository.findOne).toHaveBeenCalledTimes(1);
      expect(dashboardRepository.findOne).toHaveBeenCalledWith({
        where: {
          externalId: dashboardId,
          tenantId: mockTenantId,
        },
      });
      expect(AnalyticsUtil.generateParamList).not.toHaveBeenCalled();
      expect(analyticsInterface.getDashboardUrl).not.toHaveBeenCalled();
    });
    it('should successfully get dashboard URL with parameters', async () => {
      const dashboardId = 'dashboard-123';
      const expectedUrl =
        'https://analytics.com/dashboard-123?organization_id=tenant-23&user_id=user-123';

      dashboardRepository.findOne.mockResolvedValue(mockDashboard);
      (AnalyticsUtil.generateParamList as jest.Mock).mockReturnValue({
        organization_id: mockTenantId,
        user_id: mockUserId,
      });
      analyticsInterface.getDashboardUrl.mockResolvedValue(expectedUrl);

      const result = await service.getDashboardUrl(dashboardId);

      expect(result.url).toBe(expectedUrl);

      expect(dashboardRepository.findOne).toHaveBeenCalledTimes(1);
      expect(dashboardRepository.findOne).toHaveBeenCalledWith({
        where: {
          externalId: dashboardId,
          tenantId: mockTenantId,
        },
      });

      expect(AnalyticsUtil.generateParamList).toHaveBeenCalledTimes(1);
      expect(AnalyticsUtil.generateParamList).toHaveBeenCalledWith(
        mockDashboard.data?.params,
      );

      expect(analyticsInterface.getDashboardUrl).toHaveBeenCalledTimes(1);
      expect(analyticsInterface.getDashboardUrl).toHaveBeenCalledWith(
        dashboardId,
        { organization_id: 'tenant-23', user_id: 123 },
      );
    });
    it('should handle dashboard with no parameters', async () => {
      const dashboardWithNoParams = {
        ...mockDashboard,
        data: null,
      } as unknown as Dashboard;

      dashboardRepository.findOne.mockResolvedValue(dashboardWithNoParams);
      (AnalyticsUtil.generateParamList as jest.Mock).mockReturnValue([]);
      analyticsInterface.getDashboardUrl.mockResolvedValue(
        'https://analytics.com/simple',
      );

      const result = await service.getDashboardUrl('dashboard-123');

      expect(result.url).toBe('https://analytics.com/simple');

      expect(dashboardRepository.findOne).toHaveBeenCalledTimes(1);
      expect(dashboardRepository.findOne).toHaveBeenCalledWith({
        where: {
          externalId: 'dashboard-123',
          tenantId: mockTenantId,
        },
      });

      expect(AnalyticsUtil.generateParamList).toHaveBeenCalledTimes(1);
      expect(AnalyticsUtil.generateParamList).toHaveBeenCalledWith([]);

      expect(analyticsInterface.getDashboardUrl).toHaveBeenCalledTimes(1);
      expect(analyticsInterface.getDashboardUrl).toHaveBeenCalledWith(
        'dashboard-123',
        [],
      );
    });
  });

  describe('createDashboard', () => {
    const mockDashboardDto: CreateDashboardDto = {
      name: 'New Dashboard',
      externalId: 'new-dashboard',
      groupId: '2',
      description: 'Test dashboard',
      order: 1,
      tenantId: mockTenantId,
    };

    it('it should create a dashboard when none exists', async () => {
      const savedDashboard = {
        id: 2,
        ...mockDashboardDto,
        tenantId: mockTenantId,
      };
      dashboardRepository.findOne.mockResolvedValue(null);

      dashboardRepository.create.mockReturnValue(savedDashboard as Dashboard);
      dashboardRepository.save.mockResolvedValue(savedDashboard as Dashboard);
      const result = await service.createDashboard(mockDashboardDto);

      expect(result).toEqual(savedDashboard);

      expect(dashboardRepository.findOne).toHaveBeenCalledTimes(1);
      expect(dashboardRepository.findOne).toHaveBeenCalledWith({
        where: {
          externalId: mockDashboardDto.externalId,
          tenantId: mockTenantId,
          groupId: mockDashboardDto.groupId,
        },
      });

      expect(dashboardRepository.create).toHaveBeenCalledTimes(1);
      expect(dashboardRepository.create).toHaveBeenCalledWith({
        ...mockDashboardDto,
        tenantId: mockTenantId,
      });

      expect(dashboardRepository.save).toHaveBeenCalledTimes(1);
      expect(dashboardRepository.save).toHaveBeenCalledWith(savedDashboard);
    });
    it('should update existing dashboard when found', async () => {
      const existingDashboard = { id: 1, ...mockDashboardDto } as Dashboard;

      dashboardRepository.findOne.mockResolvedValue(existingDashboard);
      dashboardRepository.update.mockResolvedValue({ affected: 1 } as any);

      const result = await service.createDashboard(mockDashboardDto);

      expect(result).toEqual(existingDashboard);

      expect(dashboardRepository.findOne).toHaveBeenCalledTimes(1);
      expect(dashboardRepository.findOne).toHaveBeenCalledWith({
        where: {
          externalId: mockDashboardDto.externalId,
          tenantId: mockTenantId,
          groupId: mockDashboardDto.groupId,
        },
      });

      expect(dashboardRepository.update).toHaveBeenCalledTimes(1);
      expect(dashboardRepository.update).toHaveBeenCalledWith(
        { id: existingDashboard.id },
        { ...mockDashboardDto },
      );

      expect(dashboardRepository.create).not.toHaveBeenCalled();
      expect(dashboardRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('getDashboards', () => {
    it('should return when user has no groups', async () => {
      groupService.getUserRolesByUserId.mockResolvedValue([]);

      const result = await service.getDashboards(mockUserId);

      expect(result).toEqual(undefined);

      expect(groupService.getUserRolesByUserId).toHaveBeenCalledTimes(1);
      expect(groupService.getUserRolesByUserId).toHaveBeenCalledWith(
        mockUserId,
      );

      expect(dashboardRepository.find).not.toHaveBeenCalled();
    });
    it('should return dashboards when user has groups', async () => {
      const mockUserGroups = [
        {
          id: 1,
          name: 'COUNSELOR',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { id: 2, name: 'ADMIN', createdAt: new Date(), updatedAt: new Date() },
        {
          id: 3,
          name: 'LEARNER',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      groupService.getUserRolesByUserId.mockResolvedValue(mockUserGroups);
      const mockDashboards = [
        { ...mockDashboard, groupId: '1' }, // COUNSELOR
        { ...mockDashboard, groupId: '2' }, // ADMIN
        { ...mockDashboard, groupId: '3' }, // LEARNER
      ];
      dashboardRepository.find.mockResolvedValue(mockDashboards);

      const result = await service.getDashboards(mockUserId);

      expect(result).toEqual([
        { ...mockDashboards[0], analyticsType: 'CALL_LOG_ANALYTICS' },
        { ...mockDashboards[1], analyticsType: 'ORG_ANALYTICS' },
        { ...mockDashboards[2], analyticsType: 'SIMULATION_ANALYTICS' },
      ]);

      expect(groupService.getUserRolesByUserId).toHaveBeenCalledTimes(1);
      expect(groupService.getUserRolesByUserId).toHaveBeenCalledWith(
        mockUserId,
      );

      expect(dashboardRepository.find).toHaveBeenCalledTimes(1);
      expect(dashboardRepository.find).toHaveBeenCalledWith({
        where: {
          groupId: In([1, 2, 3]),
          tenantId: mockTenantId,
        },
      });
    });
  });

  describe('getCounselorStats', () => {
    it('should calculate counselor stats successfully', async () => {
      const queryParams = {
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      };
      const userId = mockUserId;

      const mockDbResult = {
        counselorName: 'John Doe',
        counselorListeningDuration: '1800.50',
        counselorSharingDuration: '600.25',
      };

      mockQueryBuilder.getRawOne.mockResolvedValue(mockDbResult);

      const result = await service.getCounselorStats(queryParams, userId);

      expect(result).toEqual({
        counselorName: 'John Doe',
        counselorListeningDuration: 1800.5,
        counselorSharingDuration: 600.25,
        counselorSharingPercentage: 25,
      });

      expect(chatRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(chatRepository.createQueryBuilder).toHaveBeenCalledWith('chat');

      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'users',
        'user',
        'user.id = chat.counselorId',
      );
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'call_details',
        'callDetails',
        'callDetails.chatId = chat.id',
      );

      expect(mockQueryBuilder.select).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        'user.name',
        'counselorName',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        `SUM(("callDetails"."callInfo" ->> 'clientTalkingTime')::float)`,
        'counselorListeningDuration',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        `SUM(("callDetails"."callInfo" ->> 'counselorTalkingTime')::float)`,
        'counselorSharingDuration',
      );

      expect(mockQueryBuilder.where).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        `callDetails.callInfo ->> 'clientTalkingTime' IS NOT NULL`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(5);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `(callDetails.callInfo ->> 'clientTalkingTime')::float > 0`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `callDetails.callInfo ->> 'counselorTalkingTime' IS NOT NULL`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `(callDetails.callInfo ->> 'counselorTalkingTime')::float >= 0`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '"chat"."startedAt" BETWEEN :startDate AND :endDate',
        {
          startDate: '2024-01-01 00:00:00',
          endDate: '2024-01-31 23:59:59',
        },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.id = :userId',
        { userId: 123 },
      );

      expect(mockQueryBuilder.groupBy).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith('user.name');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('user.name', 'ASC');

      expect(mockQueryBuilder.getRawOne).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.getRawOne).toHaveBeenCalledWith();
    });

    it('should handle only start date provided', async () => {
      const queryParams = { startDate: '2024-01-01' };
      const userId = mockUserId;

      mockQueryBuilder.getRawOne.mockResolvedValue({
        counselorName: 'Jane Doe',
        counselorListeningDuration: '1800.5',
        counselorSharingDuration: '600.25',
      });

      const result = await service.getCounselorStats(queryParams, userId);

      expect(result).toEqual({
        counselorName: 'Jane Doe',
        counselorListeningDuration: 1800.5,
        counselorSharingDuration: 600.25,
        counselorSharingPercentage: 25,
      });

      expect(chatRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(chatRepository.createQueryBuilder).toHaveBeenCalledWith('chat');

      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'users',
        'user',
        'user.id = chat.counselorId',
      );
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'call_details',
        'callDetails',
        'callDetails.chatId = chat.id',
      );

      expect(mockQueryBuilder.select).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        'user.name',
        'counselorName',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        `SUM(("callDetails"."callInfo" ->> 'clientTalkingTime')::float)`,
        'counselorListeningDuration',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        `SUM(("callDetails"."callInfo" ->> 'counselorTalkingTime')::float)`,
        'counselorSharingDuration',
      );

      expect(mockQueryBuilder.where).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        `callDetails.callInfo ->> 'clientTalkingTime' IS NOT NULL`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(5);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `(callDetails.callInfo ->> 'clientTalkingTime')::float > 0`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `callDetails.callInfo ->> 'counselorTalkingTime' IS NOT NULL`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `(callDetails.callInfo ->> 'counselorTalkingTime')::float >= 0`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '"chat"."startedAt" >= :startDate',
        { startDate: '2024-01-01 00:00:00' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.id = :userId',
        { userId: 123 },
      );

      expect(mockQueryBuilder.groupBy).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith('user.name');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('user.name', 'ASC');

      expect(mockQueryBuilder.getRawOne).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.getRawOne).toHaveBeenCalledWith();
    });

    it('should handle only end date provided', async () => {
      const queryParams = { endDate: '2024-01-31' };
      const userId = mockUserId;

      mockQueryBuilder.getRawOne.mockResolvedValue({
        counselorName: 'Bob Smith',
        counselorListeningDuration: '100',
        counselorSharingDuration: '50',
      });

      const result = await service.getCounselorStats(queryParams, userId);

      expect(result).toEqual({
        counselorName: 'Bob Smith',
        counselorListeningDuration: 100,
        counselorSharingDuration: 50,
        counselorSharingPercentage: 33.33,
      });

      expect(chatRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(chatRepository.createQueryBuilder).toHaveBeenCalledWith('chat');

      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'users',
        'user',
        'user.id = chat.counselorId',
      );
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'call_details',
        'callDetails',
        'callDetails.chatId = chat.id',
      );

      expect(mockQueryBuilder.select).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        'user.name',
        'counselorName',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        `SUM(("callDetails"."callInfo" ->> 'clientTalkingTime')::float)`,
        'counselorListeningDuration',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        `SUM(("callDetails"."callInfo" ->> 'counselorTalkingTime')::float)`,
        'counselorSharingDuration',
      );

      expect(mockQueryBuilder.where).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        `callDetails.callInfo ->> 'clientTalkingTime' IS NOT NULL`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(5);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `(callDetails.callInfo ->> 'clientTalkingTime')::float > 0`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `callDetails.callInfo ->> 'counselorTalkingTime' IS NOT NULL`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `(callDetails.callInfo ->> 'counselorTalkingTime')::float >= 0`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '"chat"."startedAt" <= :endDate',
        { endDate: '2024-01-31 23:59:59' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.id = :userId',
        { userId: 123 },
      );

      expect(mockQueryBuilder.groupBy).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith('user.name');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('user.name', 'ASC');

      expect(mockQueryBuilder.getRawOne).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.getRawOne).toHaveBeenCalledWith();
    });

    it('should handle no date filters provided', async () => {
      const queryParams = {};
      const userId = mockUserId;

      mockQueryBuilder.getRawOne.mockResolvedValue({
        counselorName: 'Alice Johnson',
        counselorListeningDuration: '200',
        counselorSharingDuration: '100',
      });

      const result = await service.getCounselorStats(queryParams, userId);

      expect(result).toEqual({
        counselorName: 'Alice Johnson',
        counselorListeningDuration: 200,
        counselorSharingDuration: 100,
        counselorSharingPercentage: 33.33,
      });

      expect(chatRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(chatRepository.createQueryBuilder).toHaveBeenCalledWith('chat');

      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'users',
        'user',
        'user.id = chat.counselorId',
      );
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'call_details',
        'callDetails',
        'callDetails.chatId = chat.id',
      );

      expect(mockQueryBuilder.select).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        'user.name',
        'counselorName',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        `SUM(("callDetails"."callInfo" ->> 'clientTalkingTime')::float)`,
        'counselorListeningDuration',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        `SUM(("callDetails"."callInfo" ->> 'counselorTalkingTime')::float)`,
        'counselorSharingDuration',
      );

      expect(mockQueryBuilder.where).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        `callDetails.callInfo ->> 'clientTalkingTime' IS NOT NULL`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(4);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `(callDetails.callInfo ->> 'clientTalkingTime')::float > 0`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `callDetails.callInfo ->> 'counselorTalkingTime' IS NOT NULL`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `(callDetails.callInfo ->> 'counselorTalkingTime')::float >= 0`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.id = :userId',
        { userId: 123 },
      );

      expect(mockQueryBuilder.groupBy).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith('user.name');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('user.name', 'ASC');

      expect(mockQueryBuilder.getRawOne).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.getRawOne).toHaveBeenCalledWith();

      const dateFilterCalls = (
        mockQueryBuilder.andWhere as jest.Mock
      ).mock.calls.filter((call) => call[0].includes('createdAt'));
      expect(dateFilterCalls).toHaveLength(0);
    });

    it('should handle zero talking time (avoid division by zero)', async () => {
      const queryParams = {};
      const userId = mockUserId;

      mockQueryBuilder.getRawOne.mockResolvedValue({
        counselorName: 'Silent Counselor',
        counselorListeningDuration: '0',
        counselorSharingDuration: '0',
      });

      const result = await service.getCounselorStats(queryParams, userId);

      expect(result).toEqual({
        counselorName: 'Silent Counselor',
        counselorListeningDuration: 0,
        counselorSharingDuration: 0,
        counselorSharingPercentage: 0,
      });

      expect(chatRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(chatRepository.createQueryBuilder).toHaveBeenCalledWith('chat');

      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'users',
        'user',
        'user.id = chat.counselorId',
      );
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'call_details',
        'callDetails',
        'callDetails.chatId = chat.id',
      );

      expect(mockQueryBuilder.select).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        'user.name',
        'counselorName',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        `SUM(("callDetails"."callInfo" ->> 'clientTalkingTime')::float)`,
        'counselorListeningDuration',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        `SUM(("callDetails"."callInfo" ->> 'counselorTalkingTime')::float)`,
        'counselorSharingDuration',
      );

      expect(mockQueryBuilder.where).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        `callDetails.callInfo ->> 'clientTalkingTime' IS NOT NULL`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(4);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `(callDetails.callInfo ->> 'clientTalkingTime')::float > 0`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `callDetails.callInfo ->> 'counselorTalkingTime' IS NOT NULL`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `(callDetails.callInfo ->> 'counselorTalkingTime')::float >= 0`,
      );
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith('user.name');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('user.name', 'ASC');
      expect(mockQueryBuilder.getRawOne).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.getRawOne).toHaveBeenCalledWith();
    });

    it('should handle null database result', async () => {
      const queryParams = {};
      const userId = 999;

      mockQueryBuilder.getRawOne.mockResolvedValue(null);

      const result = await service.getCounselorStats(queryParams, userId);

      expect(result).toEqual({
        counselorName: '',
        counselorListeningDuration: 0,
        counselorSharingDuration: 0,
        counselorSharingPercentage: 0,
      });

      expect(chatRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(chatRepository.createQueryBuilder).toHaveBeenCalledWith('chat');

      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'users',
        'user',
        'user.id = chat.counselorId',
      );
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'call_details',
        'callDetails',
        'callDetails.chatId = chat.id',
      );

      expect(mockQueryBuilder.select).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        'user.name',
        'counselorName',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        `SUM(("callDetails"."callInfo" ->> 'clientTalkingTime')::float)`,
        'counselorListeningDuration',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        `SUM(("callDetails"."callInfo" ->> 'counselorTalkingTime')::float)`,
        'counselorSharingDuration',
      );

      expect(mockQueryBuilder.where).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        `callDetails.callInfo ->> 'clientTalkingTime' IS NOT NULL`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(4);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `(callDetails.callInfo ->> 'clientTalkingTime')::float > 0`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `callDetails.callInfo ->> 'counselorTalkingTime' IS NOT NULL`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `(callDetails.callInfo ->> 'counselorTalkingTime')::float >= 0`,
      );
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith('user.name');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('user.name', 'ASC');
      expect(mockQueryBuilder.getRawOne).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.getRawOne).toHaveBeenCalledWith();
    });

    it('should handle malformed data gracefully', async () => {
      const queryParams = {};
      const userId = mockUserId;

      // Mock result with invalid numbers
      mockQueryBuilder.getRawOne.mockResolvedValue({
        counselorName: 'Test User',
        counselorListeningDuration: 'invalid-number',
        counselorSharingDuration: null,
      });

      const result = await service.getCounselorStats(queryParams, userId);

      expect(result).toEqual({
        counselorName: 'Test User',
        counselorListeningDuration: 0,
        counselorSharingDuration: 0,
        counselorSharingPercentage: 0,
      });

      expect(chatRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(chatRepository.createQueryBuilder).toHaveBeenCalledWith('chat');

      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'users',
        'user',
        'user.id = chat.counselorId',
      );
      expect(mockQueryBuilder.innerJoin).toHaveBeenCalledWith(
        'call_details',
        'callDetails',
        'callDetails.chatId = chat.id',
      );

      expect(mockQueryBuilder.select).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        'user.name',
        'counselorName',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledTimes(2);
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        `SUM(("callDetails"."callInfo" ->> 'clientTalkingTime')::float)`,
        'counselorListeningDuration',
      );
      expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith(
        `SUM(("callDetails"."callInfo" ->> 'counselorTalkingTime')::float)`,
        'counselorSharingDuration',
      );

      expect(mockQueryBuilder.where).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        `callDetails.callInfo ->> 'clientTalkingTime' IS NOT NULL`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledTimes(4);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `(callDetails.callInfo ->> 'clientTalkingTime')::float > 0`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `callDetails.callInfo ->> 'counselorTalkingTime' IS NOT NULL`,
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        `(callDetails.callInfo ->> 'counselorTalkingTime')::float >= 0`,
      );
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.groupBy).toHaveBeenCalledWith('user.name');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('user.name', 'ASC');
      expect(mockQueryBuilder.getRawOne).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.getRawOne).toHaveBeenCalledWith();
    });
  });
});
