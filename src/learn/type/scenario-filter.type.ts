import { EntityManager } from 'typeorm';
import { Scenarios } from '../entity/scenarios.entity';
import { AssignmentStatus } from 'src/common/type/common.type';

export type ScenarioFilters = {
  status?: string;
  /** Comma-separated ScenarioCategory values (mirrors `status`). */
  category?: string;
  /** Case-insensitive substring match on the partner organisation tag. */
  partnerOrgName?: string;
  tenantId?: string;
  assignmentStatus?: AssignmentStatus;
  search?: string;
  isPublic?: boolean;
  isMultiTenantAdmin?: boolean;
  userId?: number;
  languageCode?: string;
  /**
   * Include ROLEPLAY_V2 scenarios in the result. Defaults to false so the
   * learner catalog never surfaces v2 shells to ordinary users (mirrors the
   * admin list). Only set true for a v2-allowlisted requester (see
   * ScenarioService.getScenariosV2).
   */
  includeRoleplayV2?: boolean;
};

export type GetScenarioByIdOptions = {
  select?: (keyof Scenarios)[];
  em?: EntityManager;
  isPublic?: boolean;
  languageCode?: string;
  /**
   * Attach the requesting learner's completion record (see
   * ScenarioCompletionSummary). Only set by authenticated handlers — the
   * @Public() detail endpoint has no user or tenant in context, so leaving
   * this false keeps that path working exactly as before.
   */
  includeCompletion?: boolean;
};
