import {
  CourseCopilotEventType,
  CourseCopilotJobKind,
  CourseCopilotJobStatus,
  CourseCopilotMessageRole,
  CourseCopilotMode,
  CourseCopilotSessionStatus,
} from '../enum/course-copilot.enum';
import {
  CourseBlueprint,
  CourseBlueprintEstimate,
  CourseBrief,
  CourseBriefReadiness,
  CourseChangeLogEntry,
  CourseOutline,
  CoursePublishReadiness,
} from './course-copilot.type';

/**
 * REST response shapes for /v1/course-copilot. The admin app mirrors these in
 * `src/types/courseCopilot.ts`; change both together.
 */

export interface CourseCopilotBudgetView {
  /** 0 = uncapped. */
  ceilingUsd: number;
  spentUsd: number;
  /** null when uncapped. */
  remainingUsd: number | null;
  /** True while jobs are held waiting for a raise. */
  held: boolean;
}

export interface CourseCopilotSessionSummary {
  id: string;
  title: string;
  mode: CourseCopilotMode;
  status: CourseCopilotSessionStatus;
  trackId: string | null;
  trackTitle: string | null;
  trackStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CourseCopilotMessageView {
  id: string;
  seq: number;
  role: CourseCopilotMessageRole;
  content: string | null;
  toolCalls: Record<string, any>[] | null;
  toolResults: Record<string, any>[] | null;
  metadata: Record<string, any> | null;
  createdAt: string;
}

export interface CourseCopilotJobView {
  id: string;
  kind: CourseCopilotJobKind;
  blueprintItemId: string | null;
  /** The blueprint item's title, or a course-wide label ("Cover image"). */
  title: string;
  status: CourseCopilotJobStatus;
  attempts: number;
  error: string | null;
  /** "8 questions", "Created roleplay #412" — set once done. */
  summary: string | null;
  skippedReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  costUsd: number | null;
  /** Generated roleplay / case, for a link to its editor. */
  scenarioId: number | null;
  caseId: string | null;
}

export interface CourseCopilotEventView {
  seq: number;
  type: CourseCopilotEventType;
  payload: Record<string, any>;
  createdAt: string;
}

export interface CourseCopilotSessionDetail {
  session: CourseCopilotSessionSummary & {
    brief: CourseBrief;
    briefReadiness: CourseBriefReadiness;
    blueprint: CourseBlueprint | null;
    blueprintVersion: number;
    approvedBlueprint: CourseBlueprint | null;
    changeLog: CourseChangeLogEntry[];
    generatedScenarioIds: number[];
    generatedCaseIds: string[];
  };
  messages: CourseCopilotMessageView[];
  jobs: CourseCopilotJobView[];
  /** Events with seq > `afterSeq` (query param), oldest first, at most 200. */
  events: CourseCopilotEventView[];
  lastEventSeq: number;
  /** The bound course's outline with per-item previews; null before approval. */
  outline: CourseOutlineWithPreview | null;
  readiness: CoursePublishReadiness | null;
  budget: CourseCopilotBudgetView;
}

/** `PUT sessions/:id/blueprint` and the `blueprint` SSE frame. */
export interface CourseCopilotBlueprintResponse {
  blueprint: CourseBlueprint;
  version: number;
  estimate: CourseBlueprintEstimate;
  budget: CourseCopilotBudgetView;
  /** Problems that would block approval (over a limit, missing input). */
  problems: string[];
}

/**
 * The outline as the work pane reads it: the compact outline plus one small
 * preview per item, so the pane never has to load article html.
 */
export interface CourseOutlineWithPreview extends CourseOutline {
  sections: (CourseOutline['sections'][number] & {
    items: (CourseOutline['sections'][number]['items'][number] & {
      preview: CourseItemPreview;
    })[];
  })[];
}

export type CourseItemPreview =
  | {
      type: 'ARTICLE';
      excerpt: string;
      wordCount: number;
      questionCount: number;
      resourceCount: number;
      imageUrls: string[];
    }
  | {
      type: 'QUIZ';
      questionCount: number;
      passScore: number | null;
      sampleQuestion: string | null;
      questionTypes: string[];
    }
  | { type: 'JOURNAL'; prompts: string[] }
  | {
      type: 'ANNOTATED_ARTIFACT';
      unitCount: number;
      labels: string[];
      targetCount: number;
      intro: string | null;
    }
  | {
      type: 'ROLEPLAY';
      scenarioId: number | null;
      scenarioTitle: string | null;
      coverImageUrl: string | null;
      generated: boolean;
    }
  | {
      type: 'CASE';
      caseId: string | null;
      caseTitle: string | null;
      roleplayCount: number;
      generated: boolean;
    }
  | { type: 'GAME'; gameKey: string | null; intro: string | null }
  | { type: 'VIDEO'; source: string | null; url: string | null };
