import { DataSource } from 'typeorm';
import { PERMISSIONS } from '../../../authorization/constants/permissions.constants';
import { RoadmapVoteGrantRepository } from '../../repository/roadmap-vote-grant.repository';
import { RoadmapVoteGrantSchedulerRegistrationService } from '../roadmap-vote-grant-scheduler-registration.service';

describe('RoadmapVoteGrantSchedulerRegistrationService', () => {
  const build = (userIds: number[]) => {
    const query = jest
      .fn()
      .mockResolvedValue(userIds.map((userId) => ({ userId })));
    const dataSource = {
      query,
      manager: {},
    } as unknown as DataSource;
    const grantRepository = {
      grantDaily: jest.fn().mockResolvedValue(undefined),
      grantMonthly: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RoadmapVoteGrantRepository>;
    const service = new RoadmapVoteGrantSchedulerRegistrationService(
      dataSource,
      grantRepository,
    );
    return { service, query, grantRepository };
  };

  // The regression: eligibility used to be SUPER_ADMIN/SUPER_DUPER_ADMIN by group name, which
  // silently skipped every PLATFORM_ADMIN-only account even though it holds the vote permission.
  it('picks recipients by the vote permission, not by group name', async () => {
    const { service, query } = build([]);

    await service.issueDailyGrants();

    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([PERMISSIONS.VOTE_PRODUCT_ROADMAP]);
    expect(sql).toContain('group_permissions');
    expect(sql).not.toMatch(/g\.name/);
  });

  it('issues one daily grant per eligible user, keyed on the UTC day', async () => {
    const { service, grantRepository } = build([3, 17]);

    await service.issueDailyGrants();

    expect(grantRepository.grantDaily).toHaveBeenCalledTimes(2);
    expect(grantRepository.grantDaily.mock.calls.map((c) => c[1])).toEqual([
      3, 17,
    ]);
    expect(grantRepository.grantDaily.mock.calls[0][2]).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it('issues one monthly grant per eligible user, keyed on the UTC month', async () => {
    const { service, grantRepository } = build([3, 17]);

    await service.issueMonthlyGrants();

    expect(grantRepository.grantMonthly).toHaveBeenCalledTimes(2);
    expect(grantRepository.grantMonthly.mock.calls[0][2]).toMatch(
      /^\d{4}-\d{2}$/,
    );
  });
});
