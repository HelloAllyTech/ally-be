import {
  DataSource,
  DataSourceOptions,
  EntityTarget,
  Repository,
} from 'typeorm';
import * as bcrypt from 'bcrypt';
import { DB } from './config';

import { Tenant } from '../../tenant/entity/tenant.entity';
import { User } from '../../user/entity/user.entity';
import { UserPreferences } from '../../user/entity/user-preferences.entity';
import { AdminTenant } from '../../user/entity/admin-tenant.entity';
import { Group } from '../../authorization/entity/group.entity';
import { UserGroup } from '../../authorization/entity/user-group.entity';
import { Scenarios } from '../../learn/entity/scenarios.entity';
import { ScenarioTenants } from '../../learn/entity/scenario-tenants.entity';
import { ScenarioVoices } from '../../learn/entity/scenario-voices.entity';
import { ScenarioSessions } from '../../learn/entity/scenario-sessions.entity';
import { ScenarioSessionMessages } from '../../learn/entity/scenario-session-messages.entity';
import { ScenarioSessionEvents } from '../../learn/entity/scenario-session-events.entity';
import { SimulationCredits } from '../../learn/entity/simulation-credits.entity';
import { ScenarioSessionReview } from '../../scenario-session-review/entity/review.entity';
import { ScenarioSessionReviewThread } from '../../scenario-session-review/entity/thread.entity';
import { ScenarioSessionReviewComment } from '../../scenario-session-review/entity/comment.entity';
import { ScenarioSessionReviewReaction } from '../../scenario-session-review/entity/reaction.entity';
import { ScenarioSessionReviewCommentReaction } from '../../scenario-session-review/entity/comment-reaction.entity';
import { ScenarioSessionReviewReadStatus } from '../../scenario-session-review/entity/read-status.entity';
import { Languages } from '../../language/entity/languages.entity';
import { SessionEvents } from '../../session-event/entity/session-events.entity';
import { ScenarioPath } from '../../scenario-path/entity/scenario-path.entity';
import { ScenarioPathItem } from '../../scenario-path/entity/scenario-path-item.entity';
import { ScenarioPathTenant } from '../../scenario-path/entity/scenario-path-tenant.entity';
import { Badge } from '../../badge/entity/badge.entity';
import { BadgeGroup } from '../../badge/entity/badge-group.entity';
import { BadgeTenant } from '../../badge/entity/badge-tenant.entity';
import { Case } from '../../case/entity/case.entity';
import { CaseItem } from '../../case/entity/case-item.entity';
import { CaseTenant } from '../../case/entity/case-tenant.entity';
import { ScenarioCoverImageLibrary } from '../../scenario-cover-image-library/entity/scenario-cover-image-library.entity';
import { Competency } from '../../learn/entity/competency.entity';
import { Behavior } from '../../learn/entity/behavior.entity';
import { ScenarioBehaviorInstruction } from '../../learn/entity/scenario-behavior-instruction.entity';
import { Chat } from '../../chat/entity/chat.entity';
import { CallDetails } from '../../chat/entity/call.details.entity';
import { Message } from '../../chat/entity/message.entity';
import { CustomFieldDefinition } from '../../custom-fields/entity/custom-field-definition.entity';
import { ChatCustomFieldValue } from '../../custom-fields/entity/chat-custom-field-value.entity';
import { Preference } from '../../settings/entity/preference.entity';
import { ScenarioCharacter } from '../../scenario-character/entity/scenario-character.entity';
import { ScenarioTranslations } from '../../learn/entity/scenario-translation.entity';
import { TriggerWarnings } from '../../learn/entity/trigger-warnings.entity';
import { ScenarioTriggerWarnings } from '../../learn/entity/scenario-trigger-warnings.entity';
import { FillerTag } from '../../learn/entity/filler-tag.entity';
import { AgentTestCase } from '../../learn/entity/agent-test-case.entity';
import { ScenarioPathSession } from '../../scenario-path/entity/scenario-path-session.entity';
import { ScenarioPathSessionItem } from '../../scenario-path/entity/scenario-path-session-item.entity';
import { CaseSession } from '../../case/entity/case-session.entity';
import { CaseSessionItem } from '../../case/entity/case-session-item.entity';
import { ScenarioSessionDetails } from '../../learn/entity/scenario-session-details.entity';
import { ScenarioSessionChat } from '../../learn/entity/scenario-session-chat.entity';
import { ScenarioSessionChatMessage } from '../../learn/entity/scenario-session-chat-message.entity';
import { ScenarioSessionFeedbacks } from '../../learn/entity/scenario-session-feedbacks.entity';
import { ScenarioSessionRecording } from '../../learn/entity/scenario-session-recording.entity';
import { ScenarioSessionTurnMetrics } from '../../learn/entity/scenario-session-turn-metrics.entity';
import { ScenarioSessionStartMetrics } from '../../learn/entity/scenario-session-start-metrics.entity';
import { ScenarioSessionTags } from '../../learn/entity/scenario-session-tags.entity';
import { ScenarioSessionMessageTags } from '../../learn/entity/scenario-session-message-tags.entity';
import { ScenarioSessionBehaviorInstructions } from '../../learn/entity/scenario-session-behavior-instructions.entity';
import { Track } from '../../track/entity/track.entity';
import { TrackSection } from '../../track/entity/track-section.entity';
import { TrackItem } from '../../track/entity/track-item.entity';
import { TrackTenant } from '../../track/entity/track-tenant.entity';
import { TrackEnrollment } from '../../track/entity/track-enrollment.entity';
import { TrackItemProgress } from '../../track/entity/track-item-progress.entity';
import { TrackQuizAttempt } from '../../track/entity/track-quiz-attempt.entity';
import { TrackJournalEntry } from '../../track/entity/track-journal-entry.entity';
import { RoadmapOpportunity } from '../../product-roadmap/entity/roadmap-opportunity.entity';
import { RoadmapAllocation } from '../../product-roadmap/entity/roadmap-allocation.entity';
import { RoadmapOpportunityComment } from '../../product-roadmap/entity/roadmap-opportunity-comment.entity';
import { RoadmapInterviewNote } from '../../product-roadmap/entity/roadmap-interview-note.entity';
import { RoadmapSavedView } from '../../product-roadmap/entity/roadmap-saved-view.entity';
import { RoadmapUserTabOrder } from '../../product-roadmap/entity/roadmap-user-tab-order.entity';
import { RoadmapProductGoal } from '../../product-roadmap/entity/roadmap-product-goal.entity';
import { RoadmapOpportunityOwner } from '../../product-roadmap/entity/roadmap-opportunity-owner.entity';
import { LabSkill } from '../../lab/entity/lab-skill.entity';
import { LabVariable } from '../../lab/entity/lab-variable.entity';
import { LabValue } from '../../lab/entity/lab-value.entity';

export const SEED_ENTITIES = [
  Tenant,
  User,
  UserPreferences,
  AdminTenant,
  Group,
  UserGroup,
  Scenarios,
  ScenarioTenants,
  ScenarioVoices,
  ScenarioSessions,
  ScenarioSessionMessages,
  ScenarioSessionEvents,
  SimulationCredits,
  ScenarioSessionReview,
  ScenarioSessionReviewThread,
  ScenarioSessionReviewComment,
  ScenarioSessionReviewReaction,
  ScenarioSessionReviewCommentReaction,
  ScenarioSessionReviewReadStatus,
  Languages,
  SessionEvents,
  ScenarioPath,
  ScenarioPathItem,
  ScenarioPathTenant,
  Badge,
  BadgeGroup,
  BadgeTenant,
  Case,
  CaseItem,
  CaseTenant,
  ScenarioCoverImageLibrary,
  Competency,
  Behavior,
  ScenarioBehaviorInstruction,
  Chat,
  CallDetails,
  Message,
  CustomFieldDefinition,
  ChatCustomFieldValue,
  Preference,
  RoadmapProductGoal,
  RoadmapOpportunityOwner,
  RoadmapOpportunity,
  RoadmapAllocation,
  RoadmapOpportunityComment,
  RoadmapInterviewNote,
  RoadmapSavedView,
  RoadmapUserTabOrder,
  LabSkill,
  LabVariable,
  LabValue,
  ScenarioCharacter,
  ScenarioTranslations,
  TriggerWarnings,
  ScenarioTriggerWarnings,
  FillerTag,
  AgentTestCase,
  ScenarioPathSession,
  ScenarioPathSessionItem,
  CaseSession,
  CaseSessionItem,
  ScenarioSessionDetails,
  ScenarioSessionChat,
  ScenarioSessionChatMessage,
  ScenarioSessionFeedbacks,
  ScenarioSessionRecording,
  ScenarioSessionTurnMetrics,
  ScenarioSessionStartMetrics,
  ScenarioSessionTags,
  ScenarioSessionMessageTags,
  ScenarioSessionBehaviorInstructions,
  Track,
  TrackSection,
  TrackItem,
  TrackTenant,
  TrackEnrollment,
  TrackItemProgress,
  TrackQuizAttempt,
  TrackJournalEntry,
];

export function createSeedDataSource(): DataSource {
  const options: DataSourceOptions = {
    type: 'postgres',
    host: DB.host,
    port: DB.port,
    username: DB.username,
    password: DB.password,
    database: DB.database,
    entities: SEED_ENTITIES,
    synchronize: false,
    ssl: DB.ssl ? { rejectUnauthorized: false } : false,
    logging: false,
  };
  return new DataSource(options);
}

export function log(message: string): void {
  console.log(`[seed] ${message}`);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Idempotent insert: find by `matchOn`, insert if missing, return the row.
 * Does not update existing rows — seeds should be safe to re-run without
 * clobbering manually-edited dev data.
 */
export async function upsert<T extends object>(
  repo: Repository<T>,
  matchOn: Partial<T>,
  defaults: Partial<T>,
): Promise<T> {
  const existing = await repo.findOne({ where: matchOn as any });
  if (existing) return existing;
  const created = repo.create({ ...matchOn, ...defaults } as any);
  return repo.save(created as any);
}

export async function withDataSource<T>(
  fn: (ds: DataSource) => Promise<T>,
): Promise<T> {
  const ds = createSeedDataSource();
  await ds.initialize();
  try {
    return await fn(ds);
  } finally {
    await ds.destroy();
  }
}

export function getRepo<T extends object>(
  ds: DataSource,
  entity: EntityTarget<T>,
): Repository<T> {
  return ds.getRepository(entity);
}
