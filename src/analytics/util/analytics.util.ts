import { ExecutionManager } from '../../common/execution/execution-manager';

export class AnalyticsUtil {
  static getParamValue(param: string) {
    switch (param) {
      case 'organization_id':
        return ExecutionManager.getTenantId();
      case 'user_id':
        return ExecutionManager.getUserId();
    }
  }

  static generateParamList(paramKeyList: string[]) {
    return paramKeyList.map((param) => AnalyticsUtil.getParamValue(param));
  }
}
