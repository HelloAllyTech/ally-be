import { Injectable } from '@nestjs/common';

import { LogsService } from 'src/logs/logs.service';
import { AwsLogServiceKey } from 'src/config/config.service';
import { RoadmapOpportunityRepository } from 'src/product-roadmap/repository/roadmap-opportunity.repository';
import {
  RoadmapOpportunityStage,
  RoadmapOpportunityType,
} from 'src/product-roadmap/enum/roadmap-opportunity.enum';

/** Repos with a CloudWatch log group. Frontend repos have no server-side log group to query. */
const AWS_LOG_SERVICE_KEYS: AwsLogServiceKey[] = [
  'ally-be',
  'ally-ai',
  'ally-ai-learn',
];

const PROD_LOG_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ProdLogFinding {
  message: string;
  timestamp: number;
  logStreamName: string;
}

export interface ReportedBugFinding {
  id: string;
  description: string;
  createdAt: Date;
}

/**
 * Read-only data the Discover finders need from OTHER modules, proxied
 * through Bug Hunter's own api-key-guarded surface rather than having finder
 * agents authenticate against `/v1/aws-logs` or `/v1/product-roadmap/*`
 * directly. Those endpoints are `@RequireFeatureToggle`-gated — built for a
 * logged-in human, not a machine caller — and giving the pipeline a second
 * credential type (or a service *user* account) to reach them would spread
 * the auth surface it depends on across two other teams' modules. This way
 * the pipeline only ever needs to know one thing: its own `x-api-key`.
 */
@Injectable()
export class BugHunterFinderDataService {
  constructor(
    private readonly logsService: LogsService,
    private readonly opportunityRepository: RoadmapOpportunityRepository,
  ) {}

  /**
   * Last 24h of CloudWatch errors for a repo, or `null` if the repo has no
   * log group (the frontend repos: ally-web, ally-mobile) — the finder should
   * report zero findings for those rather than erroring.
   */
  async getRecentErrors(repo: string): Promise<ProdLogFinding[] | null> {
    if (!AWS_LOG_SERVICE_KEYS.includes(repo as AwsLogServiceKey)) return null;

    const endTime = Date.now();
    const startTime = endTime - PROD_LOG_WINDOW_MS;
    const { events } = await this.logsService.getLogEvents({
      service: repo as AwsLogServiceKey,
      startTime,
      endTime,
      level: 'ERROR',
    });
    return events.map((event) => ({
      message: event.message,
      timestamp: event.timestamp,
      logStreamName: event.logStreamName,
    }));
  }

  /**
   * Human-reported bugs still awaiting triage, platform-wide (roadmap items
   * have no repo field, so the finder itself judges which are about the repo
   * it's scanning). Only `stage=new` — anything already prioritised, in
   * development, released, or archived is either already being worked or a
   * closed question, and re-flagging it would just duplicate work under a
   * different "author."
   */
  async getReportedBugs(): Promise<ReportedBugFinding[]> {
    const rows = await this.opportunityRepository.find({
      where: {
        type: RoadmapOpportunityType.BUG,
        stage: RoadmapOpportunityStage.NEW,
      },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      description: row.description,
      createdAt: row.createdAt,
    }));
  }
}
