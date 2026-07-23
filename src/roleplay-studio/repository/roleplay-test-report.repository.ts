import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { RoleplayTestReport } from '../entity/roleplay-test-report.entity';
import { RoleplayTestRun } from '../entity/roleplay-test-run.entity';
import { RoleplaySpecVersion } from '../entity/roleplay-spec-version.entity';

/**
 * Poll-friendly list item for the Improve drawer — no transcript/markdown
 * payloads; `testCaseSnapshot` is trimmed to the display fields.
 */
export interface RoleplayTestReportListItem {
  id: string;
  runId: string;
  runStatus: string;
  runProgress: Record<string, any> | null;
  specVersionId: string;
  versionNumber: number | null;
  agentTestCaseId: string;
  testCaseSnapshot: {
    id: string;
    title: string;
    type: string | null;
    tags: string[];
  };
  status: string;
  verdict: string | null;
  overallScore: number | null;
  improveOfReportId: string | null;
  improveStatus: string | null;
  improveMeta: Record<string, any> | null;
  createdAt: Date;
  endedAt: Date | null;
}

@Injectable()
export class RoleplayTestReportRepository extends Repository<RoleplayTestReport> {
  constructor(private readonly dataSource: DataSource) {
    super(RoleplayTestReport, dataSource.createEntityManager());
  }

  /** Webhook key: one report per (run, agent test case). */
  findByRunAndCase(
    runId: string,
    agentTestCaseId: string,
  ): Promise<RoleplayTestReport | null> {
    return this.findOne({ where: { runId, agentTestCaseId } });
  }

  /**
   * Newest-first report list for a spec (across runs), joined with the run's
   * live status/progress and the pinned version's number.
   */
  async listBySpec(
    specId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<{ data: RoleplayTestReportListItem[]; count: number }> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const qb = this.createQueryBuilder('report')
      .leftJoin(RoleplayTestRun, 'run', 'run.id = report.runId')
      .leftJoin(
        RoleplaySpecVersion,
        'version',
        'version.id = report.specVersionId',
      )
      .where('report.specId = :specId', { specId });

    const count = await qb.getCount();
    const rows = await qb
      .select('report.id', 'id')
      .addSelect('report.runId', 'runId')
      .addSelect('run.status', 'runStatus')
      .addSelect('run.progress', 'runProgress')
      .addSelect('report.specVersionId', 'specVersionId')
      .addSelect('version.versionNumber', 'versionNumber')
      .addSelect('report.agentTestCaseId', 'agentTestCaseId')
      .addSelect('report.testCaseSnapshot', 'testCaseSnapshot')
      .addSelect('report.status', 'status')
      .addSelect('report.verdict', 'verdict')
      .addSelect('report.overallScore', 'overallScore')
      .addSelect('report.improveOfReportId', 'improveOfReportId')
      .addSelect('report.improveStatus', 'improveStatus')
      .addSelect('report.improveMeta', 'improveMeta')
      .addSelect('report.createdAt', 'createdAt')
      .addSelect('report.endedAt', 'endedAt')
      .orderBy('report.createdAt', 'DESC')
      .addOrderBy('report.id', 'DESC')
      .limit(limit)
      .offset(offset)
      .getRawMany();

    const data = rows.map((row): RoleplayTestReportListItem => {
      const snapshot = (row.testCaseSnapshot ?? {}) as Record<string, any>;
      return {
        ...row,
        versionNumber: row.versionNumber ?? null,
        overallScore: row.overallScore ?? null,
        testCaseSnapshot: {
          id: snapshot.id ?? row.agentTestCaseId,
          title: snapshot.title ?? '',
          type: snapshot.type ?? null,
          tags: Array.isArray(snapshot.tags) ? snapshot.tags : [],
        },
      };
    });
    return { data, count };
  }
}
