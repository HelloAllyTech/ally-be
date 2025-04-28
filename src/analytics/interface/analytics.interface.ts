export interface AnalyticsInterface {
  getDashboardUrl(
    dashboardId: string,
    params?: Record<string, any>,
  ): Promise<string>;

  refreshDashboardUrl(dashboardId: string): Promise<string>;
}
