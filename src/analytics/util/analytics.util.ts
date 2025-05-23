import { ExecutionManager } from '../../common/execution/execution-manager';

export class AnalyticsUtil {
  static getParamValue(param: string): string | undefined {
    switch (param) {
      case 'organization_id':
        return ExecutionManager.getTenantId();
      case 'user_id':
        return ExecutionManager.getUserId();
      default:
        return;
    }
  }

  static generateParamList(paramKeyList: string[]) {
    if (!paramKeyList || !Array.isArray(paramKeyList)) {
      return [];
    }
    return paramKeyList.map((param) => AnalyticsUtil.getParamValue(param));
  }
}
