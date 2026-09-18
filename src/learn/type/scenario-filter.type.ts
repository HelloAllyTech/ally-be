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
   * Apply the requester's cohort restrictions. Present only on the learner
   * catalog: the admin list must keep showing every scenario the tenant has,
   * restricted or not, or an admin could not see what they had restricted.
   *
   * `cohortId: null` is meaningful — it is the "Unassigned" audience, not
   * "no filtering". Pass the whole object or nothing.
   */
  cohortScope?: { cohortId: string | null };
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
