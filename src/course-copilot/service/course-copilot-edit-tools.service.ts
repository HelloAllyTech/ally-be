import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, ILike, In } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { LoggerService } from 'src/logger/logger.service';
import { AgentToolDefinition } from 'src/llm-agent/type/agent-llm.type';
import { TrackService } from 'src/track/service/track.service';
import { TrackTenantService } from 'src/track/service/track-tenant.service';
import { TrackTranslationService } from 'src/track/service/track-translation.service';
import { TrackWithStructure } from 'src/track/service/track-shared.service';
import {
  TrackItemCompletionCriteria,
  TrackItemType,
  TrackStatus,
  VideoSource,
} from 'src/track/type/track.type';
import { TrackGameKey } from 'src/track/type/game.type';
import { validateTrackItemContent } from 'src/track/service/track-structure.validator';
import {
  UpsertTrackItemDto,
  UpsertTrackSectionDto,
} from 'src/track/dto/upsert-track-structure.dto';
import { Tenant } from 'src/tenant/entity/tenant.entity';
import {
  CourseCopilotJobKind,
  CourseCopilotJobStatus,
} from '../enum/course-copilot.enum';
import { CourseCopilotSessionRepository } from '../repository/course-copilot.repository';
import {
  CourseCopilotSseFrame,
  CourseCopilotToolOutcome,
} from '../type/course-copilot-sse.type';
import { CourseBlueprintItem } from '../type/course-copilot.type';
import { COURSE_COPILOT_INLINE_SPECIALIST_TIMEOUT_MS } from '../constants/course-copilot.constants';
import {
  ItemSpecialist,
  SpecialistValidationError,
} from './specialists/specialist.types';
import { ArticleSpecialist } from './specialists/article.specialist';
import { QuizSpecialist } from './specialists/quiz.specialist';
import { JournalSpecialist } from './specialists/journal.specialist';
import { AnnotationSpecialist } from './specialists/annotation.specialist';
import { CourseCopilotStructureService } from './course-copilot-structure.service';
import {
  COURSE_COPILOT_ANALYTICS_EVENTS,
  CourseCopilotAnalyticsService,
} from './course-copilot-analytics.service';
import { CourseCopilotSessionService } from './course-copilot-session.service';
import { CourseCopilotLibraryService } from './course-copilot-library.service';
import { CourseCopilotBuildService } from './course-copilot-build.service';
import { CourseCopilotJobExecutorService } from './course-copilot-job-executor.service';
import type { CourseCopilotToolContext } from './course-copilot-tools.service';

const ITEM_TYPES = Object.values(TrackItemType) as string[];
const INLINE_TYPES = new Set<string>([
  TrackItemType.ARTICLE,
  TrackItemType.QUIZ,
  TrackItemType.JOURNAL,
  TrackItemType.ANNOTATED_ARTIFACT,
]);

const CONFIRM = 'confirm';

const LOCKED_MESSAGE =
  'Learners are enrolled in this course, so its structure is locked — adding, removing, ' +
  'reordering, changing answers or rules would break their progress. Content-only edits ' +
  '(wording, explanations, titles) still work. Ask the trainer whether to duplicate the ' +
  'course and make the change on the copy (duplicate_course), recommending it.';

const id = { type: 'string' };

export const EDIT_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    name: 'get_course_outline',
    description:
      'The course as it is now: sections and items with real ids, types, titles, orders, ' +
      'completion rules and sizes. It also arrives each turn in <course_outline>.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_item',
    description:
      'Full content of one item (article html capped at 20 KB). Read before changing it.',
    input_schema: {
      type: 'object',
      properties: { itemId: id },
      required: ['itemId'],
    },
  },
  {
    name: 'update_course_meta',
    description:
      'Change the course title, description (plain text paragraphs), cover image URL (https), ' +
      'estimated duration in minutes, or competency ids. Never its status — use publish_course.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        coverImageUrl: { type: 'string' },
        estimatedDurationMinutes: { type: 'number' },
        competencyIds: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'update_section',
    description: 'Rename a section or change its description.',
    input_schema: {
      type: 'object',
      properties: {
        sectionId: id,
        title: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['sectionId'],
    },
  },
  {
    name: 'add_section',
    description:
      'Add an empty section (after afterSectionId, or at the end). Add items to it next.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        afterSectionId: id,
      },
      required: ['title'],
    },
  },
  {
    name: 'remove_section',
    description:
      'Remove a section. Refused when it has items unless force is true — say so to the trainer first.',
    input_schema: {
      type: 'object',
      properties: { sectionId: id, force: { type: 'boolean' } },
      required: ['sectionId'],
    },
  },
  {
    name: 'move_section',
    description: 'Move a section to a 1-based position.',
    input_schema: {
      type: 'object',
      properties: { sectionId: id, position: { type: 'number' } },
      required: ['sectionId', 'position'],
    },
  },
  {
    name: 'add_item',
    description:
      'Add an item after afterItemId (or at the end of the section). ARTICLE / QUIZ / JOURNAL / ' +
      'ANNOTATED_ARTIFACT are written now from `spec` + `purpose` (e.g. quiz {questionCount, ' +
      'difficulty, questionTypes}; article {outline, wordTarget, questionCount, withImage}; ' +
      'journal {focus}; annotation {focus, behaviourLabels}). GAME needs spec.gameKey. VIDEO needs ' +
      'spec.url. ROLEPLAY: pass scenarioId to use a library roleplay, or spec {personaBrief, ' +
      'taskClass, languageIds?, minScore?, triggerWarningIds?, characterId?} to create one — that ' +
      'runs in the background (a few minutes) and appears when ready. CASE needs an existing caseId.',
    input_schema: {
      type: 'object',
      properties: {
        sectionId: id,
        afterItemId: id,
        type: { type: 'string', enum: ITEM_TYPES },
        title: { type: 'string' },
        purpose: { type: 'string' },
        spec: { type: 'object' },
        scenarioId: { type: 'number' },
        caseId: { type: 'string' },
        completionCriteria: { type: 'object' },
      },
      required: ['sectionId', 'type', 'title'],
    },
  },
  {
    name: 'regenerate_item',
    description:
      'Rewrite an item with precise instructions ("make it harder", "add two questions on ' +
      'consent"), keeping its id and position. Works for ARTICLE, QUIZ, JOURNAL, ' +
      'ANNOTATED_ARTIFACT now; for ROLEPLAY it builds a replacement roleplay in the background.',
    input_schema: {
      type: 'object',
      properties: { itemId: id, instructions: { type: 'string' } },
      required: ['itemId', 'instructions'],
    },
  },
  {
    name: 'update_item_content',
    description:
      'Small exact edits you write yourself: a new title/description, or the full `content` ' +
      'object (read it with get_item first, change what you must, send all of it back with the ' +
      'same ids). Prefer regenerate_item for anything larger than a sentence or two.',
    input_schema: {
      type: 'object',
      properties: {
        itemId: id,
        title: { type: 'string' },
        description: { type: 'string' },
        content: { type: 'object' },
      },
      required: ['itemId'],
    },
  },
  {
    name: 'remove_item',
    description: 'Remove an item from the course.',
    input_schema: {
      type: 'object',
      properties: { itemId: id },
      required: ['itemId'],
    },
  },
  {
    name: 'move_item',
    description:
      'Move an item to a 1-based position in a section (the same or another).',
    input_schema: {
      type: 'object',
      properties: { itemId: id, sectionId: id, position: { type: 'number' } },
      required: ['itemId', 'sectionId', 'position'],
    },
  },
  {
    name: 'set_completion_rule',
    description:
      'What a learner must achieve to complete an item: ROLEPLAY {minScore 0-100, ' +
      'minDurationSeconds}, CASE {minScore}, QUIZ / ANNOTATED_ARTIFACT {passScore 0-100}, VIDEO ' +
      '{watchPct 1-100}, ARTICLE {minReadSeconds}. GAME has none.',
    input_schema: {
      type: 'object',
      properties: { itemId: id, completionCriteria: { type: 'object' } },
      required: ['itemId', 'completionCriteria'],
    },
  },
  {
    name: 'set_item_reference',
    description:
      'Swap the roleplay (scenarioId) or case (caseId) behind an item. Must be published.',
    input_schema: {
      type: 'object',
      properties: {
        itemId: id,
        scenarioId: { type: 'number' },
        caseId: { type: 'string' },
      },
      required: ['itemId'],
    },
  },
  {
    name: 'generate_cover_image',
    description:
      'Generate a new cover image in the background (about a minute). Optional prompt.',
    input_schema: {
      type: 'object',
      properties: { prompt: { type: 'string' } },
    },
  },
  {
    name: 'list_organisations',
    description:
      'Organisations a course can be assigned to: [{id, name}]. Filter by name.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } } },
  },
  {
    name: 'assign_to_tenants',
    description:
      'Make the course available to organisations. Asks the trainer to confirm first; call it ' +
      'again with the same input after they confirm.',
    input_schema: {
      type: 'object',
      properties: { tenantIds: { type: 'array', items: { type: 'string' } } },
      required: ['tenantIds'],
    },
  },
  {
    name: 'request_translation',
    description:
      'Translate the course into languages (numeric language ids from get_languages). Runs in the background.',
    input_schema: {
      type: 'object',
      properties: { languageIds: { type: 'array', items: { type: 'number' } } },
      required: ['languageIds'],
    },
  },
  {
    name: 'publish_course',
    description:
      'Publish the course. Checks it is ready first and returns what is missing if not. When ' +
      'ready, it asks the trainer to confirm; call it again after they confirm to publish.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'duplicate_course',
    description:
      'Copy the course as a new DRAFT and continue working on the copy — the way to restructure ' +
      'a course learners are enrolled in. Asks the trainer to confirm first.',
    input_schema: { type: 'object', properties: {} },
  },
];

export const EDIT_TOOL_NAMES = new Set(
  EDIT_TOOL_DEFINITIONS.map((tool) => tool.name),
);
/** Usable while a build is running: they read, never write. */
export const READ_ONLY_EDIT_TOOLS = new Set(['get_course_outline', 'get_item']);

/**
 * The edit loop: course-aware tools that change a course in place.
 *
 * Every write re-reads the course under the session's structure lock, mutates
 * it, and saves through `TrackService.upsertStructure` — the editor's own
 * path — so a change made in the editor between turns is never overwritten
 * and the copilot can never save something the editor would reject. Each
 * change lands in the change log and is pushed to the pane as a
 * `course_patch` frame mid-turn. Stacks: "Making Agent Trustworthiness
 * Visible Through Transparency".
 *
 * Publishing, assigning to organisations and duplicating are confirmed in
 * code, not just in the prompt: the tool raises a question and only acts when
 * the trainer's next message answers THAT question with "confirm". Stacks:
 * "Progressive Delegation: Staged Autonomy Growth".
 */
@Injectable()
export class CourseCopilotEditToolsService {
  private readonly logger = LoggerService.getInstance(
    CourseCopilotEditToolsService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly sessionRepository: CourseCopilotSessionRepository,
    private readonly trackService: TrackService,
    private readonly trackTenantService: TrackTenantService,
    private readonly trackTranslationService: TrackTranslationService,
    private readonly structureService: CourseCopilotStructureService,
    private readonly sessionService: CourseCopilotSessionService,
    private readonly library: CourseCopilotLibraryService,
    private readonly buildService: CourseCopilotBuildService,
    private readonly executor: CourseCopilotJobExecutorService,
    private readonly article: ArticleSpecialist,
    private readonly quiz: QuizSpecialist,
    private readonly journal: JournalSpecialist,
    private readonly annotation: AnnotationSpecialist,
    @Optional() private readonly analytics?: CourseCopilotAnalyticsService,
  ) {}

  async execute(
    name: string,
    input: Record<string, any>,
    context: CourseCopilotToolContext,
  ): Promise<CourseCopilotToolOutcome> {
    if (!context.session.trackId) {
      return this.refuse(
        'no_course',
        'There is no course bound to this session yet.',
      );
    }
    // `return await`, not `return`: a returned promise skips this catch, and
    // then a locked course or a validator rejection reaches the model as a
    // raw exception instead of a refusal it knows how to explain.
    try {
      switch (name) {
        case 'get_course_outline':
          return await this.getOutline(context);
        case 'get_item':
          return await this.getItem(input, context);
        case 'update_course_meta':
          return await this.updateCourseMeta(input, context);
        case 'update_section':
          return await this.updateSection(input, context);
        case 'add_section':
          return await this.addSection(input, context);
        case 'remove_section':
          return await this.removeSection(input, context);
        case 'move_section':
          return await this.moveSection(input, context);
        case 'add_item':
          return await this.addItem(input, context);
        case 'regenerate_item':
          return await this.regenerateItem(input, context);
        case 'update_item_content':
          return await this.updateItemContent(input, context);
        case 'remove_item':
          return await this.removeItem(input, context);
        case 'move_item':
          return await this.moveItem(input, context);
        case 'set_completion_rule':
          return await this.setCompletionRule(input, context);
        case 'set_item_reference':
          return await this.setItemReference(input, context);
        case 'generate_cover_image':
          return await this.generateCover(input, context);
        case 'list_organisations':
          return await this.listOrganisations(input);
        case 'assign_to_tenants':
          return await this.assignToTenants(input, context);
        case 'request_translation':
          return await this.requestTranslation(input, context);
        case 'publish_course':
          return await this.publish(context);
        case 'duplicate_course':
          return await this.duplicate(context);
        default:
          return this.refuse('unknown_tool', `Unknown tool ${name}`);
      }
    } catch (error) {
      return this.failure(name, error);
    }
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  private async getOutline(
    context: CourseCopilotToolContext,
  ): Promise<CourseCopilotToolOutcome> {
    const track = await this.structureService.getTrack(
      context.session.trackId!,
    );
    const outline = await this.structureService.buildOutline(track);
    return {
      modelResult: {
        ok: true,
        outline: JSON.parse(this.structureService.outlineForPrompt(outline)),
      },
      summary: 'Read the course outline',
    };
  }

  private async getItem(
    input: Record<string, any>,
    context: CourseCopilotToolContext,
  ): Promise<CourseCopilotToolOutcome> {
    const track = await this.structureService.getTrack(
      context.session.trackId!,
    );
    const found = this.findItem(track, input?.itemId);
    if (!found)
      return this.refuse(
        'item_not_found',
        this.notFound('item', input?.itemId),
      );
    const { item, section } = found;
    let content: any = item.content ?? null;
    if (
      item.type === TrackItemType.ARTICLE &&
      typeof content?.html === 'string' &&
      content.html.length > 20_000
    ) {
      content = {
        ...content,
        html: `${content.html.slice(0, 20_000)}…[truncated]`,
      };
    }
    return {
      modelResult: {
        ok: true,
        item: {
          id: item.id,
          sectionId: section.id,
          type: item.type,
          order: item.order,
          title: item.title,
          description: item.description ?? null,
          scenarioId: item.scenarioId ?? null,
          caseId: item.caseId ?? null,
          completionCriteria: item.completionCriteria ?? null,
          content,
        },
      },
      summary: `Read "${item.title}"`,
    };
  }

  // ── Course meta ──────────────────────────────────────────────────────────

  private async updateCourseMeta(
    input: Record<string, any>,
    context: CourseCopilotToolContext,
  ): Promise<CourseCopilotToolOutcome> {
    const patch: Record<string, any> = {};
    if (typeof input?.title === 'string' && input.title.trim()) {
      patch.title = input.title.trim().slice(0, 200);
    }
    if (typeof input?.description === 'string')
      patch.description = input.description.trim();
    if (typeof input?.coverImageUrl === 'string') {
      if (!/^https:\/\//i.test(input.coverImageUrl.trim())) {
        return this.refuse('invalid', 'The cover image must be an https URL.');
      }
      patch.coverImageUrl = input.coverImageUrl.trim();
    }
    if (Number(input?.estimatedDurationMinutes) > 0) {
      patch.estimatedDurationMinutes = Math.round(
        Number(input.estimatedDurationMinutes),
      );
    }
    if (Array.isArray(input?.competencyIds))
      patch.competencyIds = input.competencyIds.map(String);
    if (!Object.keys(patch).length) {
      return this.refuse('no_change', 'Pass at least one field to change.');
    }
    await this.structureService.asOwner(context.session, () =>
      this.trackService.updateTrack(context.session.trackId!, patch as any),
    );
    const fields = Object.keys(patch).join(', ');
    return this.changed(
      context,
      'update_course_meta',
      `Updated the course ${fields}`,
      {},
    );
  }

  // ── Sections ─────────────────────────────────────────────────────────────

  private async updateSection(
    input: Record<string, any>,
    context: CourseCopilotToolContext,
  ) {
    let title = '';
    await this.structureService.mutate(context.session, (sections) => {
      const section = this.requireSection(sections, input?.sectionId);
      if (typeof input?.title === 'string' && input.title.trim())
        section.title = input.title.trim();
      if (typeof input?.description === 'string')
        section.description = input.description.trim();
      title = section.title;
    });
    return this.changed(
      context,
      'update_section',
      `Updated section "${title}"`,
      {
        sectionId: input.sectionId,
      },
    );
  }

  private async addSection(
    input: Record<string, any>,
    context: CourseCopilotToolContext,
  ) {
    const title = String(input?.title ?? '').trim();
    if (!title) return this.refuse('invalid', 'A section needs a title.');
    await this.structureService.mutate(context.session, (sections) => {
      const at = input?.afterSectionId
        ? sections.findIndex((s) => s.id === input.afterSectionId) + 1
        : sections.length;
      sections.splice(at <= 0 ? sections.length : at, 0, {
        title,
        description:
          typeof input?.description === 'string'
            ? input.description
            : undefined,
        order: 0,
        items: [],
      });
    });
    return this.changed(
      context,
      'add_section',
      `Added section "${title}" (empty — add items to it; an empty section blocks publishing)`,
      {},
    );
  }

  private async removeSection(
    input: Record<string, any>,
    context: CourseCopilotToolContext,
  ) {
    let title = '';
    let refused: string | null = null;
    await this.structureService.mutate(context.session, (sections) => {
      const section = this.requireSection(sections, input?.sectionId);
      title = section.title;
      if (section.items.length && input?.force !== true) {
        refused = `"${title}" has ${section.items.length} item(s). Confirm with the trainer, then call again with force: true.`;
        return;
      }
      sections.splice(sections.indexOf(section), 1);
    });
    if (refused) return this.refuse('not_empty', refused);
    return this.changed(
      context,
      'remove_section',
      `Removed section "${title}"`,
      {},
    );
  }

  private async moveSection(
    input: Record<string, any>,
    context: CourseCopilotToolContext,
  ) {
    let title = '';
    const position = Math.max(1, Math.round(Number(input?.position) || 1));
    await this.structureService.mutate(context.session, (sections) => {
      const section = this.requireSection(sections, input?.sectionId);
      title = section.title;
      sections.splice(sections.indexOf(section), 1);
      sections.splice(Math.min(position - 1, sections.length), 0, section);
    });
    return this.changed(
      context,
      'move_section',
      `Moved section "${title}" to position ${position}`,
      {
        sectionId: input.sectionId,
      },
    );
  }

  // ── Items ────────────────────────────────────────────────────────────────

  private async addItem(
    input: Record<string, any>,
    context: CourseCopilotToolContext,
  ): Promise<CourseCopilotToolOutcome> {
    const type = String(input?.type ?? '').toUpperCase();
    if (!ITEM_TYPES.includes(type))
      return this.refuse('invalid', `Unknown item type ${input?.type}.`);
    const title = String(input?.title ?? '').trim();
    if (!title) return this.refuse('invalid', 'An item needs a title.');
    const sectionId = String(input?.sectionId ?? '');
    const track = await this.structureService.getTrack(
      context.session.trackId!,
    );
    if (!track.sections.some((s) => s.id === sectionId)) {
      return this.refuse(
        'section_not_found',
        this.notFound('section', sectionId),
      );
    }
    const afterItemId = input?.afterItemId ? String(input.afterItemId) : null;
    const spec =
      input?.spec && typeof input.spec === 'object' ? input.spec : {};
    const criteria = this.criteria(
      type as TrackItemType,
      input?.completionCriteria,
    );

    // A new roleplay is minutes of work: queue it and say so.
    if (type === TrackItemType.ROLEPLAY && !input?.scenarioId) {
      const bpItem = this.blueprintItem(type, title, input, spec, criteria);
      const job = await this.buildService.enqueue(context.session, {
        kind: CourseCopilotJobKind.ROLEPLAY_NEW,
        input: {
          title,
          item: bpItem,
          placement: {
            trackSectionId: sectionId,
            afterTrackItemId: afterItemId,
          },
        },
      });
      return {
        modelResult: {
          ok: true,
          queued: true,
          jobId: job.id,
          note: 'Building the roleplay in the background (a few minutes). It appears in the course when ready; tell the trainer so.',
        },
        summary: `Creating a new roleplay "${title}" in the background`,
        events: [{ event: 'build_started', data: { jobCount: 1 } }],
      };
    }
    if (type === TrackItemType.CASE && !input?.caseId) {
      return this.refuse(
        'unsupported',
        'Creating a new case from chat is not supported yet. Add the roleplays first, then build the case in the editor — or pick an existing case with caseId.',
      );
    }

    let item: UpsertTrackItemDto;
    let imageWanted = false;
    if (type === TrackItemType.ROLEPLAY) {
      const [scenario] = await this.library.getActiveScenarios([
        Number(input.scenarioId),
      ]);
      if (!scenario)
        return this.refuse('invalid', 'That roleplay is not published.');
      item = {
        type: TrackItemType.ROLEPLAY,
        order: 0,
        title,
        scenarioId: scenario.id,
        completionCriteria: criteria,
      };
    } else if (type === TrackItemType.CASE) {
      const caseRow = await this.library.getActiveCase(String(input.caseId));
      if (!caseRow)
        return this.refuse('invalid', 'That case is not published.');
      item = {
        type: TrackItemType.CASE,
        order: 0,
        title,
        caseId: caseRow.id,
        completionCriteria: criteria,
      };
    } else if (type === TrackItemType.GAME) {
      const gameKey = (Object.values(TrackGameKey) as string[]).includes(
        spec.gameKey,
      )
        ? spec.gameKey
        : TrackGameKey.SPROUT;
      const content = {
        gameKey,
        ...(spec.intro ? { intro: String(spec.intro) } : {}),
      };
      validateTrackItemContent({ type: TrackItemType.GAME, content, title });
      item = { type: TrackItemType.GAME, order: 0, title, content };
    } else if (type === TrackItemType.VIDEO) {
      const url = String(spec.url ?? '').trim();
      if (!/^https?:\/\//i.test(url)) {
        return this.refuse(
          'needs_input',
          'A video needs a link (YouTube, Vimeo, Loom or an uploaded file). Ask the trainer for it.',
        );
      }
      const source = (Object.values(VideoSource) as string[]).includes(
        spec.source,
      )
        ? spec.source
        : this.videoSource(url);
      const content = { source, url };
      validateTrackItemContent({ type: TrackItemType.VIDEO, content, title });
      item = {
        type: TrackItemType.VIDEO,
        order: 0,
        title,
        content,
        completionCriteria: { watchPct: criteria?.watchPct ?? 90 },
      };
    } else {
      const bpItem = this.blueprintItem(type, title, input, spec, criteria);
      const output = await this.generateInline(context, bpItem, {
        placement: { trackSectionId: sectionId, afterTrackItemId: afterItemId },
      });
      imageWanted =
        type === TrackItemType.ARTICLE &&
        (spec.withImage === true ||
          context.session.brief?.look?.articleImages === 'one-per-article');
      item = {
        type: type as TrackItemType,
        order: 0,
        title,
        content: output.content,
        ...(criteria ? { completionCriteria: criteria } : {}),
      };
    }

    const { track: after } = await this.structureService.mutate(
      context.session,
      (sections) => {
        const section = this.requireSection(sections, sectionId);
        const at = afterItemId
          ? section.items.findIndex((i) => i.id === afterItemId) + 1
          : section.items.length;
        section.items.splice(
          at <= 0 && afterItemId ? section.items.length : at,
          0,
          item,
        );
      },
    );
    const created = this.newestItem(track, after, title);
    const events: CourseCopilotSseFrame[] = [];
    if (imageWanted && created) {
      await this.buildService.enqueue(context.session, {
        kind: CourseCopilotJobKind.ARTICLE_IMAGE,
        input: { title, articleTrackItemId: created.id },
      });
      events.push({ event: 'build_started', data: { jobCount: 1 } });
    }
    return this.changed(
      context,
      'add_item',
      `Added ${type.toLowerCase().replace('_', ' ')} "${title}"`,
      {
        itemId: created?.id,
        sectionId,
      },
      events,
      { itemId: created?.id ?? null },
    );
  }

  private async regenerateItem(
    input: Record<string, any>,
    context: CourseCopilotToolContext,
  ): Promise<CourseCopilotToolOutcome> {
    const instructions = String(input?.instructions ?? '').trim();
    if (!instructions) return this.refuse('invalid', 'Say what to change.');
    const track = await this.structureService.getTrack(
      context.session.trackId!,
    );
    const found = this.findItem(track, input?.itemId);
    if (!found)
      return this.refuse(
        'item_not_found',
        this.notFound('item', input?.itemId),
      );
    const { item } = found;

    if (item.type === TrackItemType.ROLEPLAY) {
      const bpItem: CourseBlueprintItem = {
        id: item.id,
        type: TrackItemType.ROLEPLAY,
        title: item.title,
        purpose: instructions,
        objectiveRefs: [],
        estimatedMinutes: 12,
        source: { kind: 'new' },
        spec: {
          personaBrief: instructions,
          minScore: item.completionCriteria?.minScore,
        },
      };
      const job = await this.buildService.enqueue(context.session, {
        kind: CourseCopilotJobKind.ROLEPLAY_NEW,
        input: {
          title: item.title,
          item: bpItem,
          replaceTrackItemId: item.id,
          instructions,
        },
      });
      return {
        modelResult: {
          ok: true,
          queued: true,
          jobId: job.id,
          note: 'A replacement roleplay is being built (a few minutes); the item will point at it when ready. The old roleplay stays in the library.',
        },
        summary: `Building a replacement roleplay for "${item.title}"`,
        events: [{ event: 'build_started', data: { jobCount: 1 } }],
      };
    }
    if (!INLINE_TYPES.has(item.type)) {
      return this.refuse(
        'unsupported',
        `${item.type} items are not generated — use update_item_content or set_item_reference.`,
      );
    }
    const bpItem: CourseBlueprintItem = {
      id: item.id,
      type: item.type,
      title: item.title,
      purpose: item.description ?? item.title,
      objectiveRefs: [],
      estimatedMinutes: 0,
      source: { kind: 'new' },
      spec: {},
      completionCriteria: item.completionCriteria ?? undefined,
    };
    const output = await this.generateInline(context, bpItem, {
      replaceTrackItemId: item.id,
      previousContent: (item.content as Record<string, any>) ?? {},
      instructions,
    });
    await this.structureService.mutate(context.session, (sections) => {
      const target = this.requireItem(sections, item.id);
      target.content = output.content;
    });
    return this.changed(
      context,
      'regenerate_item',
      `Rewrote "${item.title}" — ${output.summary}`,
      {
        itemId: item.id,
      },
    );
  }

  private async updateItemContent(
    input: Record<string, any>,
    context: CourseCopilotToolContext,
  ) {
    let title = '';
    await this.structureService.mutate(context.session, (sections) => {
      const item = this.requireItem(sections, input?.itemId);
      if (typeof input?.title === 'string' && input.title.trim())
        item.title = input.title.trim();
      if (typeof input?.description === 'string')
        item.description = input.description;
      if (input?.content && typeof input.content === 'object') {
        if (
          item.type === TrackItemType.ROLEPLAY ||
          item.type === TrackItemType.CASE
        ) {
          throw new BadRequestException(
            'Roleplay and case items have no inline content — use set_item_reference.',
          );
        }
        validateTrackItemContent({
          type: item.type,
          content: input.content,
          title: item.title,
        });
        item.content = input.content;
      }
      title = item.title;
    });
    return this.changed(context, 'update_item_content', `Edited "${title}"`, {
      itemId: input.itemId,
    });
  }

  private async removeItem(
    input: Record<string, any>,
    context: CourseCopilotToolContext,
  ) {
    let title = '';
    await this.structureService.mutate(context.session, (sections) => {
      for (const section of sections) {
        const index = section.items.findIndex((i) => i.id === input?.itemId);
        if (index < 0) continue;
        title = section.items[index].title;
        section.items.splice(index, 1);
        return;
      }
      throw new NotFoundException(this.notFound('item', input?.itemId));
    });
    return this.changed(context, 'remove_item', `Removed "${title}"`, {});
  }

  private async moveItem(
    input: Record<string, any>,
    context: CourseCopilotToolContext,
  ) {
    let title = '';
    const position = Math.max(1, Math.round(Number(input?.position) || 1));
    await this.structureService.mutate(context.session, (sections) => {
      const target = this.requireSection(sections, input?.sectionId);
      for (const section of sections) {
        const index = section.items.findIndex((i) => i.id === input?.itemId);
        if (index < 0) continue;
        const [item] = section.items.splice(index, 1);
        title = item.title;
        target.items.splice(
          Math.min(position - 1, target.items.length),
          0,
          item,
        );
        return;
      }
      throw new NotFoundException(this.notFound('item', input?.itemId));
    });
    return this.changed(
      context,
      'move_item',
      `Moved "${title}" to position ${position}`,
      {
        itemId: input.itemId,
        sectionId: input.sectionId,
      },
    );
  }

  private async setCompletionRule(
    input: Record<string, any>,
    context: CourseCopilotToolContext,
  ) {
    let title = '';
    let rule: TrackItemCompletionCriteria | undefined;
    await this.structureService.mutate(context.session, (sections) => {
      const item = this.requireItem(sections, input?.itemId);
      title = item.title;
      rule = this.criteria(item.type, input?.completionCriteria);
      if (!rule || !Object.keys(rule).length) {
        throw new BadRequestException(
          item.type === TrackItemType.GAME
            ? 'Games never gate progress, so they have no completion rule.'
            : `No valid rule for a ${item.type} item in ${JSON.stringify(input?.completionCriteria)}.`,
        );
      }
      item.completionCriteria = { ...(item.completionCriteria ?? {}), ...rule };
      // Quiz and annotation pass marks live on the content too, and the save
      // copies content → rule, so both must move together.
      if (
        rule.passScore !== undefined &&
        (item.type === TrackItemType.QUIZ ||
          item.type === TrackItemType.ANNOTATED_ARTIFACT) &&
        item.content?.settings
      ) {
        item.content = {
          ...item.content,
          settings: { ...item.content.settings, passScore: rule.passScore },
        };
      }
    });
    return this.changed(
      context,
      'set_completion_rule',
      `Set the rule on "${title}" to ${JSON.stringify(rule)}`,
      {
        itemId: input.itemId,
      },
    );
  }

  private async setItemReference(
    input: Record<string, any>,
    context: CourseCopilotToolContext,
  ) {
    let title = '';
    const scenarioId = Number(input?.scenarioId) || undefined;
    const caseId = input?.caseId ? String(input.caseId) : undefined;
    if (
      scenarioId &&
      !(await this.library.getActiveScenarios([scenarioId])).length
    ) {
      return this.refuse('invalid', 'That roleplay is not published.');
    }
    if (caseId && !(await this.library.getActiveCase(caseId))) {
      return this.refuse('invalid', 'That case is not published.');
    }
    await this.structureService.mutate(context.session, (sections) => {
      const item = this.requireItem(sections, input?.itemId);
      title = item.title;
      if (item.type === TrackItemType.ROLEPLAY && scenarioId)
        item.scenarioId = scenarioId;
      else if (item.type === TrackItemType.CASE && caseId) item.caseId = caseId;
      else
        throw new BadRequestException(
          'Pass scenarioId for a ROLEPLAY item or caseId for a CASE item.',
        );
    });
    return this.changed(
      context,
      'set_item_reference',
      `"${title}" now uses ${scenarioId ? `roleplay #${scenarioId}` : `case ${caseId}`}`,
      {
        itemId: input.itemId,
      },
    );
  }

  private async generateCover(
    input: Record<string, any>,
    context: CourseCopilotToolContext,
  ) {
    const job = await this.buildService.enqueue(context.session, {
      kind: CourseCopilotJobKind.COVER_IMAGE,
      input: {
        title: 'Cover image',
        prompt: input?.prompt ? String(input.prompt) : undefined,
      },
    });
    return {
      modelResult: {
        ok: true,
        queued: true,
        jobId: job.id,
        note: 'Generating in the background — about a minute.',
      },
      summary: 'Generating a new cover image',
      events: [{ event: 'build_started', data: { jobCount: 1 } }],
    } as CourseCopilotToolOutcome;
  }

  // ── Course-level actions ─────────────────────────────────────────────────

  private async listOrganisations(
    input: Record<string, any>,
  ): Promise<CourseCopilotToolOutcome> {
    const query = String(input?.query ?? '').trim();
    const tenants = await this.dataSource.getRepository(Tenant).find({
      where: query ? { name: ILike(`%${query}%`) } : {},
      order: { name: 'ASC' },
      take: 30,
      select: { id: true, name: true },
    });
    return {
      modelResult: {
        ok: true,
        organisations: tenants.map((t) => ({ id: t.id, name: t.name })),
      },
      summary: `Looked up ${tenants.length} organisations`,
    };
  }

  private async assignToTenants(
    input: Record<string, any>,
    context: CourseCopilotToolContext,
  ): Promise<CourseCopilotToolOutcome> {
    const requested: string[] = Array.isArray(input?.tenantIds)
      ? input.tenantIds.map(String)
      : [];
    const tenants = requested.length
      ? await this.dataSource.getRepository(Tenant).find({
          where: { id: In(requested) },
          select: { id: true, name: true },
        })
      : [];
    if (!tenants.length)
      return this.refuse(
        'invalid',
        'No matching organisations — look them up with list_organisations.',
      );
    const names = tenants.map((t) => t.name).join(', ');
    const ask = await this.confirmOrAsk(
      context,
      'assign',
      { tenantIds: tenants.map((t) => t.id) },
      {
        prompt: `Make "${await this.courseTitle(context)}" available to ${names}?`,
        confirmLabel: `Assign to ${tenants.length === 1 ? names : `${tenants.length} organisations`}`,
        rationale:
          'Learners in these organisations will be able to find and enrol in the course once it is published.',
      },
    );
    if (ask) return ask;
    const confirmed: string[] =
      context.session.metadata?.lastConfirmed?.input?.tenantIds ??
      tenants.map((t) => t.id);
    // Name what was confirmed, not what the model passed on the confirming call.
    const confirmedNames = (
      await this.dataSource.getRepository(Tenant).find({
        where: { id: In(confirmed) },
        select: { id: true, name: true },
      })
    )
      .map((tenant) => tenant.name)
      .join(', ');
    const assigned: string[] = [];
    for (const tenantId of confirmed) {
      try {
        await this.structureService.asOwner(context.session, () =>
          this.trackTenantService.assignTracksToTenant(tenantId, {
            trackIds: [context.session.trackId!],
          }),
        );
        assigned.push(tenantId);
      } catch (error) {
        // Already assigned is success from the trainer's point of view.
        if (error instanceof ConflictException) assigned.push(tenantId);
        else throw error;
      }
    }
    // Course membership is what authorises a learner to start a roleplay inside
    // the course (verified 2026-10-14: TrackProgressService.validateRoleplayStart
    // checks track_tenants, never scenario_tenants), so generated roleplays need
    // no assignment of their own.
    return this.changed(
      context,
      'assign_to_tenants',
      `Assigned the course to ${confirmedNames || names}`,
      {},
    );
  }

  private async requestTranslation(
    input: Record<string, any>,
    context: CourseCopilotToolContext,
  ) {
    const requested = (
      Array.isArray(input?.languageIds) ? input.languageIds : []
    )
      .map((value: unknown) => Number(value))
      .filter((value: number) => Number.isInteger(value) && value > 0);
    if (!requested.length)
      return this.refuse(
        'invalid',
        'Pass numeric language ids from get_languages.',
      );
    const trackId = context.session.trackId!;
    const current = await this.trackTranslationService.listForTrack(trackId);
    const existing = new Set(
      current.languages.map((language) => language.languageId),
    );
    const available = new Set(
      current.availableLanguages.map((language) => language.languageId),
    );
    const unknown = requested.filter(
      (language: number) => !available.has(language),
    );
    if (unknown.length) {
      return this.refuse(
        'invalid',
        `Not available for courses: ${unknown.join(', ')}.`,
      );
    }
    const added = requested.filter(
      (language: number) => !existing.has(language),
    );
    const again = requested.filter((language: number) =>
      existing.has(language),
    );
    if (added.length) {
      // Setting the list starts translating the newly added languages.
      await this.trackTranslationService.setLanguages(trackId, [
        ...existing,
        ...added,
      ]);
    }
    if (again.length)
      await this.trackTranslationService.translate(trackId, again);
    const labels = current.availableLanguages
      .filter((language) => requested.includes(language.languageId))
      .map((language) => language.label)
      .join(', ');
    return this.changed(
      context,
      'request_translation',
      `Started translating the course into ${labels} — review each language in the editor before publishing it`,
      {},
    );
  }

  private async publish(
    context: CourseCopilotToolContext,
  ): Promise<CourseCopilotToolOutcome> {
    const track = await this.structureService.getTrack(
      context.session.trackId!,
    );
    if (track.status === TrackStatus.ACTIVE) {
      return {
        modelResult: { ok: true, alreadyPublished: true },
        summary: 'The course is already published',
      };
    }
    const readiness = await this.structureService.readiness(track);
    if (!readiness.ready) {
      return {
        modelResult: {
          ok: false,
          error: 'not_ready',
          missing: readiness.checks
            .filter((check) => !check.ok)
            .map((check) => check.detail ?? check.label),
          note: 'Tell the trainer what is missing and offer to fix what you can (e.g. generate_cover_image).',
        },
        summary: 'Not ready to publish yet',
      };
    }
    const ask = await this.confirmOrAsk(
      context,
      'publish',
      {},
      {
        prompt: `Publish "${track.title}" now?`,
        confirmLabel: 'Publish now',
        rationale:
          'Publishing makes it available to every organisation it is assigned to. After learners enrol, its structure is locked.',
      },
    );
    if (ask) return ask;
    await this.structureService.asOwner(context.session, () =>
      this.trackService.updateTrack(track.id, {
        status: TrackStatus.ACTIVE,
      } as any),
    );
    this.analytics?.capture(
      COURSE_COPILOT_ANALYTICS_EVENTS.COURSE_PUBLISHED,
      context.userId,
      { session_id: context.session.id, track_id: track.id },
    );
    return this.changed(
      context,
      'publish_course',
      `Published "${track.title}"`,
      {},
    );
  }

  private async duplicate(
    context: CourseCopilotToolContext,
  ): Promise<CourseCopilotToolOutcome> {
    const track = await this.structureService.getTrack(
      context.session.trackId!,
    );
    const ask = await this.confirmOrAsk(
      context,
      'duplicate',
      {},
      {
        prompt: `Make a draft copy of "${track.title}" and continue on the copy?`,
        confirmLabel: 'Duplicate and switch to the copy',
        rationale:
          'The original stays as it is for the learners already enrolled.',
      },
    );
    if (ask) return ask;
    const copy = await this.structureService.asOwner(context.session, () =>
      this.trackService.duplicateTrack(track.id),
    );
    await this.sessionRepository.update(
      { id: context.session.id },
      {
        trackId: copy.id,
        trackIdMap: { sections: {}, items: {} } as any,
        title: (copy.title ?? 'Copy of course').slice(0, 200),
      },
    );
    context.session.trackId = copy.id;
    context.session.trackIdMap = { sections: {}, items: {} };
    return this.changed(
      context,
      'duplicate_course',
      `Duplicated the course — now editing "${copy.title ?? 'the copy'}"`,
      {},
      [],
      {
        newTrackId: copy.id,
      },
    );
  }

  /**
   * Null when the trainer's message in THIS turn confirmed THIS action;
   * otherwise a confirmation question that ends the turn. The pending
   * confirmation is stored, so the action carried out is the one that was
   * asked about — not whatever the model passes the second time.
   */
  private async confirmOrAsk(
    context: CourseCopilotToolContext,
    action: string,
    actionInput: Record<string, any>,
    copy: { prompt: string; confirmLabel: string; rationale: string },
  ): Promise<CourseCopilotToolOutcome | null> {
    const pending = context.session.metadata?.pendingConfirmation as
      | { action: string; questionId: string; input: Record<string, any> }
      | undefined;
    const answer = context.answer;
    if (
      pending?.action === action &&
      answer?.questionId === pending.questionId &&
      answer.selectedOptionIds?.includes(CONFIRM)
    ) {
      const lastConfirmed = {
        action,
        input: pending.input,
        at: new Date().toISOString(),
      };
      await this.sessionService.patchMetadata(context.session.id, {
        pendingConfirmation: null,
        lastConfirmed,
      });
      context.session.metadata = {
        ...(context.session.metadata ?? {}),
        pendingConfirmation: null,
        lastConfirmed,
      };
      return null;
    }
    const questionId = uuidv4();
    const question = {
      id: questionId,
      prompt: copy.prompt,
      kind: 'singleSelect',
      rationale: copy.rationale,
      options: [
        { id: CONFIRM, label: copy.confirmLabel, recommended: true },
        { id: 'cancel', label: 'Not now' },
      ],
      allowCustom: false,
    };
    const pendingConfirmation = { action, questionId, input: actionInput };
    await this.sessionService.patchMetadata(context.session.id, {
      pendingConfirmation,
    });
    context.session.metadata = {
      ...(context.session.metadata ?? {}),
      pendingConfirmation,
    };
    return {
      modelResult: {
        ok: true,
        awaitingConfirmation: true,
        questionId,
        note: 'The trainer has been asked to confirm; the turn ends. If they confirm, call this tool again with the same input.',
      },
      summary: `Asked to confirm: ${copy.prompt}`,
      events: [{ event: 'question', data: question }],
      endTurn: true,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Run an inline specialist now, with one repair pass, bounded by a timeout. */
  private async generateInline(
    context: CourseCopilotToolContext,
    item: CourseBlueprintItem,
    extra: Record<string, any>,
  ) {
    const specialist = this.specialistFor(item.type);
    const pseudoJob = {
      id: `inline-${uuidv4()}`,
      kind: CourseCopilotJobKind.ARTICLE,
      input: { title: item.title, item, ...extra },
      status: CourseCopilotJobStatus.RUNNING,
    } as any;
    const run = async (repairErrors?: string[]) => {
      const specialistContext = await this.executor.specialistContext(
        context.session,
        {
          ...pseudoJob,
          input: {
            ...pseudoJob.input,
            ...(repairErrors ? { repairErrors } : {}),
          },
        },
        { courseCopilotSessionId: context.session.id, tool: 'edit_loop' },
      );
      return specialist.generate(specialistContext);
    };
    const withTimeout = <T>(promise: Promise<T>) =>
      Promise.race([
        promise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error('Writing that took too long. Try a smaller change.'),
              ),
            COURSE_COPILOT_INLINE_SPECIALIST_TIMEOUT_MS,
          ),
        ),
      ]);
    try {
      return await withTimeout(run());
    } catch (error) {
      if (error instanceof SpecialistValidationError) {
        return withTimeout(run(error.errors));
      }
      throw error;
    }
  }

  private specialistFor(type: string): ItemSpecialist {
    switch (type) {
      case TrackItemType.ARTICLE:
        return this.article;
      case TrackItemType.QUIZ:
        return this.quiz;
      case TrackItemType.JOURNAL:
        return this.journal;
      case TrackItemType.ANNOTATED_ARTIFACT:
        return this.annotation;
      default:
        throw new BadRequestException(`${type} items are not generated.`);
    }
  }

  private blueprintItem(
    type: string,
    title: string,
    input: Record<string, any>,
    spec: Record<string, any>,
    criteria?: TrackItemCompletionCriteria,
  ): CourseBlueprintItem {
    return {
      id: uuidv4(),
      type: type as TrackItemType,
      title,
      purpose: String(input?.purpose ?? title),
      objectiveRefs: [],
      estimatedMinutes: 0,
      source: { kind: 'new' },
      spec,
      ...(criteria ? { completionCriteria: criteria } : {}),
    };
  }

  /** Only the keys that mean something for this type, clamped. */
  private criteria(
    type: TrackItemType,
    raw: unknown,
  ): TrackItemCompletionCriteria | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const source = raw as Record<string, any>;
    const pct = (value: unknown, min = 0) => {
      const number = Number(value);
      return Number.isFinite(number)
        ? Math.max(min, Math.min(100, number))
        : undefined;
    };
    const seconds = (value: unknown) => {
      const number = Number(value);
      return Number.isFinite(number) && number >= 0
        ? Math.round(number)
        : undefined;
    };
    const rule: TrackItemCompletionCriteria = {};
    switch (type) {
      case TrackItemType.ROLEPLAY:
        if (pct(source.minScore) !== undefined)
          rule.minScore = pct(source.minScore);
        if (seconds(source.minDurationSeconds) !== undefined)
          rule.minDurationSeconds = seconds(source.minDurationSeconds);
        break;
      case TrackItemType.CASE:
        if (pct(source.minScore) !== undefined)
          rule.minScore = pct(source.minScore);
        break;
      case TrackItemType.QUIZ:
      case TrackItemType.ANNOTATED_ARTIFACT:
        if (pct(source.passScore) !== undefined)
          rule.passScore = pct(source.passScore);
        break;
      case TrackItemType.VIDEO:
        if (pct(source.watchPct, 1) !== undefined)
          rule.watchPct = pct(source.watchPct, 1);
        break;
      case TrackItemType.ARTICLE:
        if (seconds(source.minReadSeconds) !== undefined)
          rule.minReadSeconds = seconds(source.minReadSeconds);
        break;
      default:
        break;
    }
    return Object.keys(rule).length ? rule : undefined;
  }

  private videoSource(url: string): VideoSource {
    const host = (() => {
      try {
        return new URL(url).hostname.toLowerCase();
      } catch {
        return '';
      }
    })();
    if (host.includes('youtu')) return VideoSource.YOUTUBE;
    if (host.includes('vimeo')) return VideoSource.VIMEO;
    if (host.includes('loom')) return VideoSource.LOOM;
    return VideoSource.S3;
  }

  private findItem(track: TrackWithStructure, itemId: unknown) {
    for (const section of track.sections) {
      const item = section.items.find((candidate) => candidate.id === itemId);
      if (item) return { item, section };
    }
    return null;
  }

  private requireSection(
    sections: UpsertTrackSectionDto[],
    sectionId: unknown,
  ): UpsertTrackSectionDto {
    const section = sections.find((candidate) => candidate.id === sectionId);
    if (!section)
      throw new NotFoundException(this.notFound('section', sectionId));
    return section;
  }

  private requireItem(
    sections: UpsertTrackSectionDto[],
    itemId: unknown,
  ): UpsertTrackItemDto {
    for (const section of sections) {
      const item = section.items.find((candidate) => candidate.id === itemId);
      if (item) return item;
    }
    throw new NotFoundException(this.notFound('item', itemId));
  }

  /** The row a write just created: in `after`, not in `before`, with this title. */
  private newestItem(
    before: TrackWithStructure,
    after: TrackWithStructure,
    title: string,
  ) {
    const known = new Set(
      before.sections.flatMap((s) => s.items.map((i) => i.id)),
    );
    return after.sections
      .flatMap((s) => s.items)
      .find((item) => !known.has(item.id) && item.title === title);
  }

  private notFound(kind: 'item' | 'section', value: unknown) {
    return `No ${kind} with id ${String(value)} in this course. Use the ids in <course_outline>.`;
  }

  private async courseTitle(context: CourseCopilotToolContext) {
    const track = await this.structureService.getTrack(
      context.session.trackId!,
    );
    return track.title;
  }

  /** Log the change, push the new outline, and tell the model it landed. */
  private async changed(
    context: CourseCopilotToolContext,
    tool: string,
    summary: string,
    target: { itemId?: string; sectionId?: string },
    extraEvents: CourseCopilotSseFrame[] = [],
    extraResult: Record<string, any> = {},
  ): Promise<CourseCopilotToolOutcome> {
    await this.sessionService.appendChangeLog(context.session.id, {
      summary,
      tool,
      ...(target.itemId ? { itemId: target.itemId } : {}),
      ...(target.sectionId ? { sectionId: target.sectionId } : {}),
    });
    const track = await this.structureService.getTrack(
      context.session.trackId!,
    );
    const outline = await this.structureService.buildOutline(track, {
      withPreview: true,
      generatedScenarioIds: context.session.generatedScenarioIds,
      generatedCaseIds: context.session.generatedCaseIds,
    });
    return {
      modelResult: { ok: true, changed: summary, ...extraResult },
      summary,
      events: [
        ...extraEvents,
        {
          event: 'course_patch',
          data: {
            summary,
            outline,
            itemIds: target.itemId ? [target.itemId] : [],
          },
        },
      ],
    };
  }

  private refuse(error: string, message: string): CourseCopilotToolOutcome {
    return { modelResult: { ok: false, error, message }, summary: message };
  }

  private failure(name: string, error: unknown): CourseCopilotToolOutcome {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof ConflictException && /locked/i.test(message)) {
      return {
        modelResult: {
          ok: false,
          error: 'structure_locked',
          message: LOCKED_MESSAGE,
        },
        summary: 'The course structure is locked because learners are enrolled',
      };
    }
    if (error instanceof SpecialistValidationError) {
      return this.refuse(
        'generation_failed',
        `The generated content did not pass checks twice: ${error.errors.slice(0, 3).join('; ')}`,
      );
    }
    if (
      error instanceof BadRequestException ||
      error instanceof NotFoundException ||
      error instanceof ConflictException
    ) {
      return this.refuse('invalid', message);
    }
    this.logger.error(`Course Copilot edit tool ${name} failed: ${message}`);
    return this.refuse('tool_failed', `That change failed: ${message}`);
  }
}
