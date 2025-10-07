import { AnalyticsUtil } from '../analytics.util';
import { ExecutionManager } from '../../../common/execution/execution-manager';

// Mock the ExecutionManager
jest.mock('../../../common/execution/execution-manager', () => ({
  ExecutionManager: {
    getTenantId: jest.fn(),
    getUserId: jest.fn(),
  },
}));

describe('AnalyticsUtil', () => {
  const mockTenantId = 'tenant-123';
  const mockUserId = 'user-456';

  beforeEach(() => {
    jest.clearAllMocks();
    (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
    (ExecutionManager.getUserId as jest.Mock).mockReturnValue(mockUserId);
  });

  describe('getParamValue', () => {
    it('should return tenant ID for organization_id parameter', () => {
      const result = AnalyticsUtil.getParamValue('organization_id');
      expect(result).toBe(mockTenantId);
      expect(ExecutionManager.getTenantId).toHaveBeenCalledTimes(1);
    });

    it('should return user ID for user_id parameter', () => {
      const result = AnalyticsUtil.getParamValue('user_id');
      expect(result).toBe(mockUserId);
      expect(ExecutionManager.getUserId).toHaveBeenCalledTimes(1);
    });

    it('should return undefined for unknown parameter', () => {
      const result = AnalyticsUtil.getParamValue('unknown_param');
      expect(result).toBeUndefined();
      expect(ExecutionManager.getTenantId).not.toHaveBeenCalled();
      expect(ExecutionManager.getUserId).not.toHaveBeenCalled();
    });

    it('should return undefined for empty string parameter', () => {
      const result = AnalyticsUtil.getParamValue('');
      expect(result).toBeUndefined();
      expect(ExecutionManager.getTenantId).not.toHaveBeenCalled();
      expect(ExecutionManager.getUserId).not.toHaveBeenCalled();
    });

    it('should return undefined for null parameter', () => {
      const result = AnalyticsUtil.getParamValue(null as any);
      expect(result).toBeUndefined();
      expect(ExecutionManager.getTenantId).not.toHaveBeenCalled();
      expect(ExecutionManager.getUserId).not.toHaveBeenCalled();
    });

    it('should return undefined for undefined parameter', () => {
      const result = AnalyticsUtil.getParamValue(undefined as any);
      expect(result).toBeUndefined();
      expect(ExecutionManager.getTenantId).not.toHaveBeenCalled();
      expect(ExecutionManager.getUserId).not.toHaveBeenCalled();
    });

    it('should handle case-sensitive parameter names', () => {
      const result = AnalyticsUtil.getParamValue('Organization_ID');
      expect(result).toBeUndefined();
      expect(ExecutionManager.getTenantId).not.toHaveBeenCalled();
    });

    it('should handle ExecutionManager returning null values', () => {
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(null);
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(null);

      expect(AnalyticsUtil.getParamValue('organization_id')).toBeNull();
      expect(AnalyticsUtil.getParamValue('user_id')).toBeNull();
    });

    it('should handle ExecutionManager returning undefined values', () => {
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(undefined);
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(undefined);

      expect(AnalyticsUtil.getParamValue('organization_id')).toBeUndefined();
      expect(AnalyticsUtil.getParamValue('user_id')).toBeUndefined();
    });
  });

  describe('generateParamList', () => {
    it('should generate parameter list with valid parameters', () => {
      const paramKeyList = ['organization_id', 'user_id'];
      const result = AnalyticsUtil.generateParamList(paramKeyList);

      expect(result).toEqual({
        organization_id: mockTenantId,
        user_id: mockUserId,
      });
      expect(ExecutionManager.getTenantId).toHaveBeenCalledTimes(1);
      expect(ExecutionManager.getUserId).toHaveBeenCalledTimes(1);
    });

    it('should generate parameter list with only organization_id', () => {
      const paramKeyList = ['organization_id'];
      const result = AnalyticsUtil.generateParamList(paramKeyList);

      expect(result).toEqual({
        organization_id: mockTenantId,
      });
      expect(ExecutionManager.getTenantId).toHaveBeenCalledTimes(1);
      expect(ExecutionManager.getUserId).not.toHaveBeenCalled();
    });

    it('should generate parameter list with only user_id', () => {
      const paramKeyList = ['user_id'];
      const result = AnalyticsUtil.generateParamList(paramKeyList);

      expect(result).toEqual({
        user_id: mockUserId,
      });
      expect(ExecutionManager.getTenantId).not.toHaveBeenCalled();
      expect(ExecutionManager.getUserId).toHaveBeenCalledTimes(1);
    });

    it('should filter out unknown parameters', () => {
      const paramKeyList = [
        'organization_id',
        'unknown_param',
        'user_id',
        'another_unknown',
      ];
      const result = AnalyticsUtil.generateParamList(paramKeyList);

      expect(result).toEqual({
        organization_id: mockTenantId,
        user_id: mockUserId,
      });
      expect(ExecutionManager.getTenantId).toHaveBeenCalledTimes(1);
      expect(ExecutionManager.getUserId).toHaveBeenCalledTimes(1);
    });

    it('should return empty object for empty array', () => {
      const result = AnalyticsUtil.generateParamList([]);
      expect(result).toEqual({});
      expect(ExecutionManager.getTenantId).not.toHaveBeenCalled();
      expect(ExecutionManager.getUserId).not.toHaveBeenCalled();
    });

    it('should return empty array for null input', () => {
      const result = AnalyticsUtil.generateParamList(null as any);
      expect(result).toEqual([]);
      expect(ExecutionManager.getTenantId).not.toHaveBeenCalled();
      expect(ExecutionManager.getUserId).not.toHaveBeenCalled();
    });

    it('should return empty array for undefined input', () => {
      const result = AnalyticsUtil.generateParamList(undefined as any);
      expect(result).toEqual([]);
      expect(ExecutionManager.getTenantId).not.toHaveBeenCalled();
      expect(ExecutionManager.getUserId).not.toHaveBeenCalled();
    });

    it('should return empty array for non-array input', () => {
      const result = AnalyticsUtil.generateParamList('not-an-array' as any);
      expect(result).toEqual([]);
      expect(ExecutionManager.getTenantId).not.toHaveBeenCalled();
      expect(ExecutionManager.getUserId).not.toHaveBeenCalled();
    });

    it('should return empty array for object input', () => {
      const result = AnalyticsUtil.generateParamList({} as any);
      expect(result).toEqual([]);
      expect(ExecutionManager.getTenantId).not.toHaveBeenCalled();
      expect(ExecutionManager.getUserId).not.toHaveBeenCalled();
    });

    it('should handle duplicate parameters', () => {
      const paramKeyList = [
        'organization_id',
        'user_id',
        'organization_id',
        'user_id',
      ];
      const result = AnalyticsUtil.generateParamList(paramKeyList);

      expect(result).toEqual({
        organization_id: mockTenantId,
        user_id: mockUserId,
      });
      expect(ExecutionManager.getTenantId).toHaveBeenCalledTimes(2);
      expect(ExecutionManager.getUserId).toHaveBeenCalledTimes(2);
    });

    it('should handle parameters with null/undefined values from ExecutionManager', () => {
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(null);
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(undefined);

      const paramKeyList = ['organization_id', 'user_id', 'unknown_param'];
      const result = AnalyticsUtil.generateParamList(paramKeyList);

      expect(result).toEqual({});
      expect(ExecutionManager.getTenantId).toHaveBeenCalledTimes(1);
      expect(ExecutionManager.getUserId).toHaveBeenCalledTimes(1);
    });

    it('should handle mixed valid and invalid parameters', () => {
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(null);
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(mockUserId);

      const paramKeyList = ['organization_id', 'user_id', 'unknown_param'];
      const result = AnalyticsUtil.generateParamList(paramKeyList);

      expect(result).toEqual({
        user_id: mockUserId,
      });
      expect(ExecutionManager.getTenantId).toHaveBeenCalledTimes(1);
      expect(ExecutionManager.getUserId).toHaveBeenCalledTimes(1);
    });

    it('should handle array with empty strings', () => {
      const paramKeyList = ['', 'organization_id', '', 'user_id', ''];
      const result = AnalyticsUtil.generateParamList(paramKeyList);

      expect(result).toEqual({
        organization_id: mockTenantId,
        user_id: mockUserId,
      });
      expect(ExecutionManager.getTenantId).toHaveBeenCalledTimes(1);
      expect(ExecutionManager.getUserId).toHaveBeenCalledTimes(1);
    });

    it('should handle array with null/undefined elements', () => {
      const paramKeyList = [
        null,
        'organization_id',
        undefined,
        'user_id',
        null,
      ] as any;
      const result = AnalyticsUtil.generateParamList(paramKeyList);

      expect(result).toEqual({
        organization_id: mockTenantId,
        user_id: mockUserId,
      });
      expect(ExecutionManager.getTenantId).toHaveBeenCalledTimes(1);
      expect(ExecutionManager.getUserId).toHaveBeenCalledTimes(1);
    });
  });
});
