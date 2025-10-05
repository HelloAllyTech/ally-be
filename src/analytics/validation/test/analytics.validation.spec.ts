import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import {
  DashboardDataDto,
  DashboardParamsDto,
  CreateDashboardDto,
  DashboardIdParamDto,
  CounselorStatsQueryDto,
  CounselorStatsResponseDto,
} from '../analytics.validation';

describe('Analytics Validation DTOs', () => {
  describe('DashboardDataDto', () => {
    it('should validate with valid params array', async () => {
      const dto = plainToClass(DashboardDataDto, {
        params: ['organization_id', 'user_id'],
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should validate with empty params array', async () => {
      const dto = plainToClass(DashboardDataDto, {
        params: [],
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should validate with undefined params', async () => {
      const dto = plainToClass(DashboardDataDto, {});

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should validate with null params', async () => {
      const dto = plainToClass(DashboardDataDto, {
        params: null,
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should fail validation with non-array params', async () => {
      const dto = plainToClass(DashboardDataDto, {
        params: 'not-an-array',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('params');
      expect(errors[0].constraints?.isArray).toBeDefined();
    });

    it('should fail validation with array containing non-string elements', async () => {
      const dto = plainToClass(DashboardDataDto, {
        params: ['valid-string', 123, null, 'another-valid'],
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('params');
      expect(errors[0].constraints?.isString).toBeDefined();
    });

    it('should fail validation with array containing objects', async () => {
      const dto = plainToClass(DashboardDataDto, {
        params: ['valid-string', { invalid: 'object' }],
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('params');
      expect(errors[0].constraints?.isString).toBeDefined();
    });
  });

  describe('DashboardParamsDto', () => {
    it('should validate with valid params object', async () => {
      const dto = plainToClass(DashboardParamsDto, {
        params: { organization_id: 'org-123', user_id: 'user-456' },
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should validate with empty params object', async () => {
      const dto = plainToClass(DashboardParamsDto, {
        params: {},
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should validate with undefined params', async () => {
      const dto = plainToClass(DashboardParamsDto, {});

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should validate with null params', async () => {
      const dto = plainToClass(DashboardParamsDto, {
        params: null,
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should fail validation with non-object params', async () => {
      const dto = plainToClass(DashboardParamsDto, {
        params: 'not-an-object',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('params');
      expect(errors[0].constraints?.isObject).toBeDefined();
    });

    it('should fail validation with array params', async () => {
      const dto = plainToClass(DashboardParamsDto, {
        params: ['array', 'not', 'object'],
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('params');
      expect(errors[0].constraints?.isObject).toBeDefined();
    });

    it('should handle JSON string transformation', () => {
      const dto = plainToClass(DashboardParamsDto, {
        params: '{"key": "value"}',
      });

      expect(dto.params).toEqual({ key: 'value' });
    });

    it('should handle invalid JSON string transformation', () => {
      const dto = plainToClass(DashboardParamsDto, {
        params: 'invalid-json',
      });

      expect(dto.params).toBe('invalid-json');
    });
  });

  describe('CreateDashboardDto', () => {
    it('should validate with all required fields', async () => {
      const dto = plainToClass(CreateDashboardDto, {
        name: 'Test Dashboard',
        externalId: 'dashboard-123',
        groupId: 'group-456',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should validate with all fields including optional ones', async () => {
      const dto = plainToClass(CreateDashboardDto, {
        name: 'Test Dashboard',
        externalId: 'dashboard-123',
        groupId: 'group-456',
        description: 'Test description',
        order: 1,
        data: {
          params: ['organization_id', 'user_id'],
        },
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should fail validation without name', async () => {
      const dto = plainToClass(CreateDashboardDto, {
        externalId: 'dashboard-123',
        groupId: 'group-456',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('name');
      expect(errors[0].constraints?.isNotEmpty).toBeDefined();
    });

    it('should fail validation with empty name', async () => {
      const dto = plainToClass(CreateDashboardDto, {
        name: '',
        externalId: 'dashboard-123',
        groupId: 'group-456',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('name');
      expect(errors[0].constraints?.isNotEmpty).toBeDefined();
    });

    it('should fail validation with non-string name', async () => {
      const dto = plainToClass(CreateDashboardDto, {
        name: 123,
        externalId: 'dashboard-123',
        groupId: 'group-456',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('name');
      expect(errors[0].constraints?.isString).toBeDefined();
    });

    it('should fail validation without externalId', async () => {
      const dto = plainToClass(CreateDashboardDto, {
        name: 'Test Dashboard',
        groupId: 'group-456',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('externalId');
      expect(errors[0].constraints?.isNotEmpty).toBeDefined();
    });

    it('should fail validation with empty externalId', async () => {
      const dto = plainToClass(CreateDashboardDto, {
        name: 'Test Dashboard',
        externalId: '',
        groupId: 'group-456',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('externalId');
      expect(errors[0].constraints?.isNotEmpty).toBeDefined();
    });

    it('should fail validation without groupId', async () => {
      const dto = plainToClass(CreateDashboardDto, {
        name: 'Test Dashboard',
        externalId: 'dashboard-123',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('groupId');
      expect(errors[0].constraints?.isNotEmpty).toBeDefined();
    });

    it('should fail validation with empty groupId', async () => {
      const dto = plainToClass(CreateDashboardDto, {
        name: 'Test Dashboard',
        externalId: 'dashboard-123',
        groupId: '',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('groupId');
      expect(errors[0].constraints?.isNotEmpty).toBeDefined();
    });

    it('should fail validation with non-string groupId', async () => {
      const dto = plainToClass(CreateDashboardDto, {
        name: 'Test Dashboard',
        externalId: 'dashboard-123',
        groupId: 123,
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('groupId');
      expect(errors[0].constraints?.isString).toBeDefined();
    });

    it('should fail validation with non-string description', async () => {
      const dto = plainToClass(CreateDashboardDto, {
        name: 'Test Dashboard',
        externalId: 'dashboard-123',
        groupId: 'group-456',
        description: 123,
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('description');
      expect(errors[0].constraints?.isString).toBeDefined();
    });

    it('should fail validation with non-number order', async () => {
      const dto = plainToClass(CreateDashboardDto, {
        name: 'Test Dashboard',
        externalId: 'dashboard-123',
        groupId: 'group-456',
        order: 'not-a-number',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('order');
      expect(errors[0].constraints?.isNumber).toBeDefined();
    });

    it('should validate with multiple validation errors', async () => {
      const dto = plainToClass(CreateDashboardDto, {
        name: '',
        externalId: '',
        groupId: '',
        description: 123,
        order: 'invalid',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(5);

      const errorProperties = errors.map((error) => error.property);
      expect(errorProperties).toContain('name');
      expect(errorProperties).toContain('externalId');
      expect(errorProperties).toContain('groupId');
      expect(errorProperties).toContain('description');
      expect(errorProperties).toContain('order');
    });
  });

  describe('DashboardIdParamDto', () => {
    it('should validate with valid dashboardId', async () => {
      const dto = plainToClass(DashboardIdParamDto, {
        dashboardId: 'dashboard-123',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should fail validation without dashboardId', async () => {
      const dto = plainToClass(DashboardIdParamDto, {});

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('dashboardId');
      expect(errors[0].constraints?.isNotEmpty).toBeDefined();
    });

    it('should fail validation with empty dashboardId', async () => {
      const dto = plainToClass(DashboardIdParamDto, {
        dashboardId: '',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('dashboardId');
      expect(errors[0].constraints?.isNotEmpty).toBeDefined();
    });

    it('should fail validation with non-string dashboardId', async () => {
      const dto = plainToClass(DashboardIdParamDto, {
        dashboardId: 123,
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('dashboardId');
      expect(errors[0].constraints?.isString).toBeDefined();
    });

    it('should fail validation with null dashboardId', async () => {
      const dto = plainToClass(DashboardIdParamDto, {
        dashboardId: null,
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('dashboardId');
      expect(errors[0].constraints?.isNotEmpty).toBeDefined();
    });
  });

  describe('CounselorStatsQueryDto', () => {
    it('should validate with valid date strings', async () => {
      const dto = plainToClass(CounselorStatsQueryDto, {
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should validate with only startDate', async () => {
      const dto = plainToClass(CounselorStatsQueryDto, {
        startDate: '2024-01-01',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should validate with only endDate', async () => {
      const dto = plainToClass(CounselorStatsQueryDto, {
        endDate: '2024-01-31',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should validate with no dates', async () => {
      const dto = plainToClass(CounselorStatsQueryDto, {});

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should fail validation with invalid startDate format', async () => {
      const dto = plainToClass(CounselorStatsQueryDto, {
        startDate: 'invalid-date',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('startDate');
      expect(errors[0].constraints?.isDateString).toBeDefined();
    });

    it('should fail validation with invalid endDate format', async () => {
      const dto = plainToClass(CounselorStatsQueryDto, {
        endDate: 'not-a-date',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('endDate');
      expect(errors[0].constraints?.isDateString).toBeDefined();
    });

    it('should fail validation with non-string startDate', async () => {
      const dto = plainToClass(CounselorStatsQueryDto, {
        startDate: 123,
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('startDate');
      expect(errors[0].constraints?.isDateString).toBeDefined();
    });

    it('should fail validation with non-string endDate', async () => {
      const dto = plainToClass(CounselorStatsQueryDto, {
        endDate: new Date(),
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('endDate');
      expect(errors[0].constraints?.isDateString).toBeDefined();
    });

    it('should validate with ISO date strings', async () => {
      const dto = plainToClass(CounselorStatsQueryDto, {
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-01-31T23:59:59.999Z',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should validate with partial ISO date strings', async () => {
      const dto = plainToClass(CounselorStatsQueryDto, {
        startDate: '2024-01-01T00:00:00',
        endDate: '2024-01-31T23:59:59',
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  describe('CounselorStatsResponseDto', () => {
    it('should validate with all required fields', async () => {
      const dto = plainToClass(CounselorStatsResponseDto, {
        counselorName: 'John Doe',
        counselorListeningDuration: 1800.5,
        counselorSharingDuration: 600.25,
        counselorSharingPercentage: 25.0,
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should validate with zero values', async () => {
      const dto = plainToClass(CounselorStatsResponseDto, {
        counselorName: '',
        counselorListeningDuration: 0,
        counselorSharingDuration: 0,
        counselorSharingPercentage: 0,
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should validate with negative values', async () => {
      const dto = plainToClass(CounselorStatsResponseDto, {
        counselorName: 'Test Counselor',
        counselorListeningDuration: -100,
        counselorSharingDuration: -50,
        counselorSharingPercentage: -25,
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should validate with large values', async () => {
      const dto = plainToClass(CounselorStatsResponseDto, {
        counselorName: 'Test Counselor',
        counselorListeningDuration: 999999.99,
        counselorSharingDuration: 999999.99,
        counselorSharingPercentage: 100,
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should validate with decimal values', async () => {
      const dto = plainToClass(CounselorStatsResponseDto, {
        counselorName: 'Test Counselor',
        counselorListeningDuration: 123.456789,
        counselorSharingDuration: 789.123456,
        counselorSharingPercentage: 33.333333,
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });
});
