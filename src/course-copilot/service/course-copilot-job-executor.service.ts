import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { TrackService } from 'src/track/service/track.service';
import { TrackWithStructure } from 'src/track/service/track-shared.service';
import { TrackItemType, VideoSource } from 'src/track/type/track.type';
import { TrackGameKey } from 'src/track/type/game.type';
import { validateTrackItemContent } from 'src/track/service/track-structure.validator';
import { CaseService } from 'src/case/service/case.service';
import { CaseStatus } from 'src/case/type/cases.type';
import { AgentBuilderChainService } from 'src/learn/service/agent-builder-chain.service';
import { ScenarioDifficultyLevel } from 'src/learn/type/scenario.type';
import { CourseCopilotSession } from '../entity/course-copilot-session.entity';
import { CourseCopilotJob } from '../entity/course-copilot-job.entity';
import {
  CourseCopilotJobKind,
  CourseCopilotJobStatus,
  CourseCopilotMessageRole,
} from '../enum/course-copilot.enum';
import {
  CourseCopilotJobRepository,
  CourseCopilotMessageRepository,
} from '../repository/course-copilot.repository';
import {
  CourseBlueprint,
  CourseBlueprintItem,
  CourseBlueprintSection,
  CourseCopilotJobResult,
  CourseReviewFinding,
} from '../type/course-copilot.type';
import {
  COURSE_COPILOT_LIMITS,
  COURSE_COPILOT_SCENARIO_CATEGORY,
} from '../constants/course-copilot.constants';
import { SpecialistContext } from './specialists/specialist.types';
import { ArticleSpecialist } from './specialists/article.specialist';
import { QuizSpecialist } from './specialists/quiz.specialist';
import { JournalSpecialist } from './specialists/journal.specialist';
import { AnnotationSpecialist } from './specialists/annotation.specialist';
import { CourseMetaSpecialist } from './specialists/course-meta.specialist';
import { CourseReviewSpecialist } from './specialists/course-review.specialist';
import { ImagePromptSpecialist } from './specialists/image-prompt.specialist';
import { RoleplayBriefSpecialist } from './specialists/roleplay-brief.specialist';
import {
  CourseCopilotJobSkip,
  CourseCopilotMediaService,
} from './course-copilot-media.service';
import { CourseCopilotStructureService } from './course-copilot-structure.service';
import { CourseCopilotSessionService } from './course-copilot-session.service';
import { CourseCopilotLibraryService } from './course-copilot-library.service';

const textOf = (html: unknown, max = 4_000): string => {
  const text =
    typeof html === 'string'
      ? html
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

/**
 * Runs one job: the specialist (or library lookup) for its kind, plus the
 * side effect on the course where the job owns one (meta, cover).
 *
 * Item content is NOT written here. A finished item job returns its content
 * and the structure service places it — in blueprint order during the first
 * build, or into the live course afterwards — so ordering lives in one place.
 */
@Injectable()
export class CourseCopilotJobExecutorService {
  private readonly logger = LoggerService.getInstance(
    CourseCopilotJobExecutorService.name,
  );

  constructor(
    private readonly trackService: TrackService,
    private readonly caseService: CaseService,
    private readonly chain: AgentBuilderChainService,
    private readonly jobRepository: CourseCopilotJobRepository,
    private readonly messageRepository: CourseCopilotMessageRepository,
    private readonly structureService: CourseCopilotStructureService,
    private readonly sessionService: CourseCopilotSessionService,
    private readonly library: CourseCopilotLibraryService,
    private readonly media: CourseCopilotMediaService,
    private readonly article: ArticleSpecialist,
    private readonly quiz: QuizSpecialist,
    private readonly journal: JournalSpecialist,
    private readonly annotation: AnnotationSpecialist,
    private readonly courseMeta: CourseMetaSpecialist,
    private readonly review: CourseReviewSpecialist,
    private readonly imagePrompt: ImagePromptSpecialist,
    private readonly roleplayBrief: RoleplayBriefSpecialist,
  ) {}

  async execute(
    session: CourseCopilotSession,
    job: CourseCopilotJob,
  ): Promise<CourseCopilotJobResult> {
    const usageMetadata = {
      courseCopilotSessionId: session.id,
      jobId: job.id,
      jobKind: job.kind,
    };
    switch (job.kind) {
      case CourseCopilotJobKind.ARTICLE:
      case CourseCopilotJobKind.QUIZ:
      case CourseCopilotJobKind.JOURNAL:
      case CourseCopilotJobKind.ANNOTATED_ARTIFACT: {
        const context = await this.specialistContext(
          session,
          job,
          usageMetadata,
        );
        const specialist = {
          [CourseCopilotJobKind.ARTICLE]: this.article,
          [CourseCopilotJobKind.QUIZ]: this.quiz,
          [CourseCopilotJobKind.JOURNAL]: this.journal,
          [CourseCopilotJobKind.ANNOTATED_ARTIFACT]: this.annotation,
        }[job.kind];
        const output = await specialist.generate(context);
        return {
          content: output.content,
          summary: output.summary,
          ...(output.imageBrief ? { imageBrief: output.imageBrief } : {}),
        };
      }
      case CourseCopilotJobKind.GAME:
        return this.gameContent(job.input?.item);
      case CourseCopilotJobKind.VIDEO:
        return this.videoContent(job.input?.item);
      case CourseCopilotJobKind.ROLEPLAY_REF:
        return this.roleplayRef(job.input?.item);
      case CourseCopilotJobKind.CASE_REF:
        return this.caseRef(job.input?.item);
      case CourseCopilotJobKind.ROLEPLAY_NEW:
        return this.roleplayNew(session, job, usageMetadata);
      case CourseCopilotJobKind.CASE_NEW:
        return this.caseNew(session, job);
      case CourseCopilotJobKind.COURSE_META:
        return this.courseMetaJob(session, usageMetadata);
      case CourseCopilotJobKind.COVER_IMAGE:
        return this.coverImage(session, job, usageMetadata);
      case CourseCopilotJobKind.ARTICLE_IMAGE:
        return this.articleImage(session, job, usageMetadata);
      case CourseCopilotJobKind.COURSE_REVIEW:
        return this.courseReview(session, usageMetadata);
      default:
        throw new Error(`Unknown job kind ${job.kind}`);
    }
  }

  // ── Context ──────────────────────────────────────────────────────────────

  async specialistContext(
    session: CourseCopilotSession,
    job: CourseCopilotJob,
    usageMetadata: Record<string, any>,
  ): Promise<SpecialistContext> {
    const item = job.input?.item as CourseBlueprintItem;
    let blueprint = session.approvedBlueprint ?? session.blueprint ?? null;
    let section = blueprint?.sections.find(
      (s) => s.id === job.input?.sectionId,
    );
    // Edit-loop jobs have no blueprint node of their own: describe the live
    // course as one so the specialist still knows where the item sits.
    if (
      !blueprint ||
      !section ||
      job.input?.placement ||
      job.input?.replaceTrackItemId
    ) {
      const track = session.trackId
        ? await this.structureService.getTrack(session.trackId)
        : null;
      if (track) {
        blueprint = this.blueprintFromTrack(track, session, item, job.input);
        section =
          blueprint.sections.find((s) =>
            s.items.some((i) => i.id === item.id),
          ) ?? blueprint.sections[0];
      }
    }
    if (!blueprint || !section) {
      throw new Error('The job has no course context to write against.');
    }
    return {
      sessionId: session.id,
      brief: session.brief ?? {},
      blueprint,
      section,
      item,
      ...(job.input?.previousContent
        ? {
            previous: {
              content: job.input.previousContent,
              instructions: String(job.input.instructions ?? ''),
            },
          }
        : {}),
      ...(Array.isArray(job.input?.repairErrors) &&
      job.input.repairErrors.length
        ? { repairErrors: job.input.repairErrors }
        : {}),
      usageMetadata,
    };
  }

  /**
   * The live course as a blueprint: each track section and item with its real
   * title, the new item inserted where the tool asked for it.
   */
  blueprintFromTrack(
    track: TrackWithStructure,
    session: CourseCopilotSession,
    newItem: CourseBlueprintItem,
    input: Record<string, any>,
  ): CourseBlueprint {
    const sections: CourseBlueprintSection[] = track.sections.map((section) => {
      const items: CourseBlueprintItem[] = section.items
        .filter((item) => item.id !== input?.replaceTrackItemId)
        .map((item) => ({
          id: item.id,
          type: item.type,
          title: item.title,
          purpose: item.description ?? '',
          objectiveRefs: [],
          estimatedMinutes: 0,
          source: { kind: 'new' as const },
          spec: {},
        }));
      const placeAfter =
        input?.placement?.trackSectionId === section.id
          ? input.placement.afterTrackItemId
          : undefined;
      const replaceIndex = section.items.findIndex(
        (item) => item.id === input?.replaceTrackItemId,
      );
      if (replaceIndex >= 0) {
        items.splice(replaceIndex, 0, newItem);
      } else if (input?.placement?.trackSectionId === section.id) {
        const at = placeAfter
          ? items.findIndex((item) => item.id === placeAfter) + 1
          : items.length;
        items.splice(Math.max(0, at), 0, newItem);
      }
      return {
        id: section.id,
        title: section.title,
        description: section.description ?? '',
        purpose: '',
        items,
      };
    });
    return {
      title: track.title,
      description: textOf(track.description, 600),
      estimatedDurationMinutes: track.estimatedDurationMinutes ?? 0,
      competencyIds: track.competencyIds ?? session.brief?.competencyIds ?? [],
      cover: { mode: track.coverImageUrl ? 'library' : 'upload-later' },
      sections,
      estimate: { usd: 0, minutes: 0, items: 0, newRoleplays: 0, images: 0 },
    };
  }

  // ── No-model items ───────────────────────────────────────────────────────

  private gameContent(item: CourseBlueprintItem): CourseCopilotJobResult {
    const requested = String(item?.spec?.gameKey ?? '');
    const gameKey = (Object.values(TrackGameKey) as string[]).includes(
      requested,
    )
      ? (requested as TrackGameKey)
      : TrackGameKey.TREX_RUNNER;
    const content = {
      gameKey,
      ...(typeof item?.spec?.intro === 'string' && item.spec.intro.trim()
        ? { intro: item.spec.intro.trim() }
        : {}),
    };
    validateTrackItemContent({
      type: TrackItemType.GAME,
      content,
      title: item?.title,
    });
    return { content, summary: gameKey };
  }

  private videoContent(item: CourseBlueprintItem): CourseCopilotJobResult {
    const url = String(item?.spec?.url ?? '').trim();
    if (!url || item?.source?.kind === 'needs-input') {
      throw new CourseCopilotJobSkip(
        'Needs a video link — add the video in the course editor.',
      );
    }
    const sources = Object.values(VideoSource) as string[];
    const source = sources.includes(item.spec.source)
      ? (item.spec.source as VideoSource)
      : VideoSource.YOUTUBE;
    const content = {
      source,
      url,
      ...(Number(item.spec.durationSeconds) > 0
        ? { durationSeconds: Number(item.spec.durationSeconds) }
        : {}),
    };
    validateTrackItemContent({
      type: TrackItemType.VIDEO,
      content,
      title: item.title,
    });
    return { content, summary: `${source} video` };
  }

  private async roleplayRef(
    item: CourseBlueprintItem,
  ): Promise<CourseCopilotJobResult> {
    const scenarioId = Number(
      (item?.source as any)?.scenarioId ?? item?.spec?.scenarioId,
    );
    const [scenario] = scenarioId
      ? await this.library.getActiveScenarios([scenarioId])
      : [];
    if (!scenario) {
      throw new CourseCopilotJobSkip(
        'That library roleplay is no longer published — pick another in the editor.',
      );
    }
    return { scenarioId: scenario.id, summary: `Uses "${scenario.title}"` };
  }

  private async caseRef(
    item: CourseBlueprintItem,
  ): Promise<CourseCopilotJobResult> {
    const caseId = String(
      (item?.source as any)?.caseId ?? item?.spec?.caseId ?? '',
    );
    const caseRow = caseId ? await this.library.getActiveCase(caseId) : null;
    if (!caseRow) {
      throw new CourseCopilotJobSkip(
        'That library case is no longer published — pick another in the editor.',
      );
    }
    return { caseId: caseRow.id, summary: `Uses "${caseRow.title}"` };
  }

  // ── Roleplays and cases ──────────────────────────────────────────────────

  private async roleplayNew(
    session: CourseCopilotSession,
    job: CourseCopilotJob,
    usageMetadata: Record<string, any>,
  ): Promise<CourseCopilotJobResult> {
    const context = await this.specialistContext(session, job, usageMetadata);
    const item = context.item;
    const spec = item.spec ?? {};
    const brief = session.brief ?? {};
    const actor = await this.roleplayBrief.write(context);

    const languageIds = (
      (Array.isArray(spec.languageIds) && spec.languageIds.length
        ? spec.languageIds
        : brief.shape?.languageIds) ?? []
    )
      .map(String)
      .slice(0, COURSE_COPILOT_LIMITS.languagesPerRoleplay);
    const competencyIds = brief.competencyIds ?? [];
    if (!competencyIds.length) {
      throw new Error(
        'A new roleplay needs a competency, and the brief has none.',
      );
    }
    const track = session.trackId
      ? await this.structureService.getTrack(session.trackId).catch(() => null)
      : null;
    const imageryOn =
      (brief.look?.articleImages ?? 'none') !== 'none' ||
      brief.look?.cover === 'generate';

    const created = await this.structureService.asOwner(session, () =>
      this.chain.buildScenarioFromBrief(
        {
          actorDescription: actor.actorDescription,
          agentTestCases: actor.agentTestCases,
          competencyId: competencyIds[0],
          competencyIds,
          competencyName: brief.competencyNames?.[0],
          languageIds,
          personaGender: actor.personaGender,
          personaAge: actor.personaAge,
          difficultyLevel:
            (actor.difficultyLevel as ScenarioDifficultyLevel) ?? undefined,
          triggerWarningIds: Array.isArray(spec.triggerWarningIds)
            ? spec.triggerWarningIds.map(String)
            : undefined,
          coverImageUrl: imageryOn ? (track?.coverImageUrl ?? null) : null,
          titleHint: actor.title ?? item.title,
          characterId:
            typeof spec.characterId === 'string' ? spec.characterId : undefined,
          saveCharacter: spec.saveCharacter === true,
          category: COURSE_COPILOT_SCENARIO_CATEGORY,
          provenance:
            `Generated by Course Copilot for the course "${context.blueprint.title}" ` +
            `(section "${context.section.title}"). Brief:\n${actor.actorDescription}`,
        } as any,
        {
          userId: session.createdBy,
          tenantId: session.tenantId ?? null,
          usageMetadata,
        },
      ),
    );
    await this.sessionService.addGenerated(
      session.id,
      'scenario',
      created.scenarioId,
    );
    if (created.characterId) {
      await this.sessionService.addGenerated(
        session.id,
        'character',
        created.characterId,
      );
    }
    return {
      scenarioId: created.scenarioId,
      ...(created.characterId ? { characterId: created.characterId } : {}),
      summary: created.summary || `Created roleplay "${created.title}"`,
    };
  }

  private async caseNew(
    session: CourseCopilotSession,
    job: CourseCopilotJob,
  ): Promise<CourseCopilotJobResult> {
    const item = job.input?.item as CourseBlueprintItem;
    const members = (job.dependsOn ?? []).length
      ? await this.jobRepository.find({ where: { id: In(job.dependsOn) } })
      : [];
    const order = new Map(
      (job.dependsOn ?? []).map((id, index) => [id, index]),
    );
    const scenarioIds = members
      .filter((member) => member.status === CourseCopilotJobStatus.DONE)
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .map((member) => member.result?.scenarioId)
      .filter((id): id is number => Boolean(id));
    if (scenarioIds.length < 2) {
      throw new CourseCopilotJobSkip(
        'A case needs at least two roleplays, and fewer than two were created.',
      );
    }
    const scenarios = await this.library.getActiveScenarios(scenarioIds);
    const track = session.trackId
      ? await this.structureService.getTrack(session.trackId).catch(() => null)
      : null;
    const coverImageUrl =
      scenarios.find((s) => s.coverImageUrl)?.coverImageUrl ??
      track?.coverImageUrl;
    if (!coverImageUrl) {
      throw new CourseCopilotJobSkip(
        'A published case needs a cover image and none was available — create the case in the editor once the course has a cover.',
      );
    }
    const minScore = item.completionCriteria?.minScore ?? 60;
    const created = await this.structureService.asOwner(session, () =>
      this.caseService.createCase({
        title: item.title,
        description:
          item.purpose ||
          `Practice chain for the course "${session.approvedBlueprint?.title ?? session.title}".`,
        coverImageUrl,
        isGlobal: false,
        status: CaseStatus.ACTIVE,
        scenarios: scenarioIds.map((scenarioId, index) => ({
          scenarioId,
          minimumScore: minScore,
          order: index + 1,
        })),
      } as any),
    );
    await this.sessionService.addGenerated(session.id, 'case', created.id);
    return {
      caseId: created.id,
      summary: `Created case "${created.title ?? item.title}" (${scenarioIds.length} roleplays)`,
    };
  }

  // ── Course-wide ──────────────────────────────────────────────────────────

  private async courseMetaJob(
    session: CourseCopilotSession,
    usageMetadata: Record<string, any>,
  ): Promise<CourseCopilotJobResult> {
    const blueprint = session.approvedBlueprint ?? session.blueprint;
    if (!blueprint || !session.trackId) {
      throw new CourseCopilotJobSkip('No course to describe yet.');
    }
    const meta = await this.courseMeta.generate({
      sessionId: session.id,
      brief: session.brief ?? {},
      blueprint,
      usageMetadata,
    });
    await this.structureService.asOwner(session, () =>
      this.trackService.updateTrack(session.trackId!, {
        title: meta.title,
        description: meta.description,
      } as any),
    );
    return {
      title: meta.title,
      description: meta.description,
      summary: meta.title,
    };
  }

  private async coverImage(
    session: CourseCopilotSession,
    job: CourseCopilotJob,
    usageMetadata: Record<string, any>,
  ): Promise<CourseCopilotJobResult> {
    if (!session.trackId) throw new CourseCopilotJobSkip('No course yet.');
    const reason = this.media.unavailableReason();
    if (reason) throw new CourseCopilotJobSkip(reason);
    const blueprint = session.approvedBlueprint ?? session.blueprint;
    const track = await this.structureService.getTrack(session.trackId);
    const prompt =
      (job.input?.prompt as string | undefined)?.trim() ||
      (await this.imagePrompt.write({
        sessionId: session.id,
        brief: session.brief ?? {},
        purpose: 'cover',
        title: track.title ?? blueprint?.title ?? 'Course',
        context: [
          blueprint?.cover?.prompt,
          textOf(track.description, 800) || blueprint?.description,
        ]
          .filter(Boolean)
          .join('\n'),
        usageMetadata,
      }));
    const imageUrl = await this.media.generate(prompt, {
      purpose: 'cover',
      name: track.title ?? 'course',
      usageMetadata,
    });
    await this.structureService.asOwner(session, () =>
      this.trackService.updateTrack(session.trackId!, {
        coverImageUrl: imageUrl,
      } as any),
    );
    return { imageUrl, summary: 'Cover image set' };
  }

  /**
   * Illustrate one article. During the first build the article's content
   * lives on its job until the structure write, so the image goes there; once
   * the course exists it goes straight into the live item.
   */
  private async articleImage(
    session: CourseCopilotSession,
    job: CourseCopilotJob,
    usageMetadata: Record<string, any>,
  ): Promise<CourseCopilotJobResult> {
    const reason = this.media.unavailableReason();
    if (reason) throw new CourseCopilotJobSkip(reason);
    const articleJob = job.input?.articleJobId
      ? await this.jobRepository.findOne({
          where: { id: job.input.articleJobId },
        })
      : null;
    const html: string = articleJob?.result?.content?.html ?? '';
    const brief =
      articleJob?.result?.imageBrief ??
      job.input?.imageBrief ??
      textOf(html, 400);
    const title = String(
      job.input?.title ?? articleJob?.input?.title ?? 'Article',
    );
    const prompt = await this.imagePrompt.write({
      sessionId: session.id,
      brief: session.brief ?? {},
      purpose: 'article',
      title,
      context: `${brief}\n\n${textOf(html, 1_200)}`,
      usageMetadata,
    });
    const imageUrl = await this.media.generate(prompt, {
      purpose: 'article',
      name: title,
      usageMetadata,
    });
    const figure = `<p><img src="${imageUrl}" alt="${title.replace(/"/g, '')}"></p>`;

    // The first build keeps content on the job until the structure write; the
    // edit loop (which passes the live item id) and any later retry write the
    // live course directly.
    const liveItemId = job.input?.articleTrackItemId as string | undefined;
    if (
      !liveItemId &&
      articleJob?.result?.content &&
      !session.metadata?.buildCompletedAt
    ) {
      const content = this.withImage(
        articleJob.result.content,
        figure,
        imageUrl,
      );
      await this.jobRepository.update(
        { id: articleJob.id },
        { result: { ...articleJob.result, content } as any },
      );
    } else {
      const trackItemId =
        liveItemId ??
        (articleJob?.blueprintItemId
          ? session.trackIdMap?.items?.[articleJob.blueprintItemId]
          : undefined);
      if (!trackItemId) {
        throw new CourseCopilotJobSkip(
          'The article this image was for is gone.',
        );
      }
      await this.structureService.mutate(session, (sections) => {
        for (const section of sections) {
          const item = section.items.find((i) => i.id === trackItemId);
          if (item?.content) {
            item.content = this.withImage(item.content, figure, imageUrl);
          }
        }
      });
    }
    return { imageUrl, summary: 'Image added' };
  }

  private withImage(
    content: Record<string, any>,
    figure: string,
    imageUrl: string,
  ): Record<string, any> {
    const html = String(content.html ?? '');
    // After the first paragraph: the image illustrates the opening, and the
    // reader meets text before a picture.
    const firstClose = html.indexOf('</p>');
    const nextHtml =
      firstClose >= 0
        ? `${html.slice(0, firstClose + 4)}${figure}${html.slice(firstClose + 4)}`
        : `${figure}${html}`;
    const imageUrls = [...new Set([...(content.imageUrls ?? []), imageUrl])];
    return { ...content, html: nextHtml, imageUrls };
  }

  /**
   * The critic pass. Its findings are posted into the chat as one message
   * with action chips, rather than applied: the trainer decides.
   * Stacks: "Add Critic Agents to Review Generated Code";
   * "Making Agent Trustworthiness Visible Through Transparency".
   */
  private async courseReview(
    session: CourseCopilotSession,
    usageMetadata: Record<string, any>,
  ): Promise<CourseCopilotJobResult> {
    if (!session.trackId)
      throw new CourseCopilotJobSkip('No course to review.');
    const track = await this.structureService.getTrack(session.trackId);
    const findings: CourseReviewFinding[] = await this.review.review({
      sessionId: session.id,
      brief: session.brief ?? {},
      courseDigest: this.courseDigest(track),
      usageMetadata,
    });
    const fixes = findings.filter((f) => f.severity === 'fix').length;
    const content = findings.length
      ? `The course is built. I reviewed it end to end: ${fixes} thing${
          fixes === 1 ? '' : 's'
        } I'd fix and ${findings.length - fixes} worth considering. Pick one to apply, or open the course in the editor.`
      : 'The course is built, and the review found nothing I would change. Open it in the editor, or tell me what to adjust.';
    await this.messageRepository.appendMessage(session.id, {
      role: CourseCopilotMessageRole.ASSISTANT,
      content,
      metadata: {
        reviewNotes: { findings },
        // No suggestedActions: the chat renders an Apply action on each
        // finding that names a tool, so chips would repeat them.
      },
      createdBy: null,
    });
    return {
      findings,
      summary: findings.length ? `${findings.length} findings` : 'No findings',
    };
  }

  /** Compact outline plus the content a reviewer needs, capped. */
  courseDigest(track: TrackWithStructure): string {
    const lines: string[] = [
      `COURSE: ${track.title}`,
      `DESCRIPTION: ${textOf(track.description, 600)}`,
      `COVER: ${track.coverImageUrl ? 'set' : 'missing'}`,
    ];
    for (const section of track.sections) {
      lines.push(`\n## Section ${section.order}: ${section.title}`);
      for (const item of section.items) {
        const content = (item.content ?? {}) as any;
        lines.push(
          `\n### [${item.id}] ${item.order}. ${item.type} — ${item.title}` +
            (item.completionCriteria
              ? ` rule=${JSON.stringify(item.completionCriteria)}`
              : ''),
        );
        switch (item.type) {
          case TrackItemType.ARTICLE: {
            // Whole articles: an excerpt cut mid-sentence reads to the
            // reviewer as a truncated article, which it then reports.
            const full = textOf(content.html, 100_000);
            lines.push(
              full.length > 9_000
                ? `${full.slice(0, 9_000)} [digest excerpt — the article continues; not a defect]`
                : full,
            );
            break;
          }
          case TrackItemType.QUIZ:
            for (const question of (content.questions ?? []).slice(0, 20)) {
              // fill_blank carries its text in `template`, often with an empty prompt.
              lines.push(
                `- (${question.type}) ${[question.prompt, question.template].filter((part: unknown) => typeof part === 'string' && part.trim()).join(' — ')}`,
              );
              if (Array.isArray(question.blanks)) {
                lines.push(
                  `  blanks: ${question.blanks.map((blank: any) => `${blank.id} = ${(blank.acceptedAnswers ?? []).join(' / ')}`).join('; ')}`,
                );
              }
              const options = question.options ?? question.items ?? [];
              if (options.length) {
                lines.push(
                  `  options: ${options.map((o: any) => `${o.id === question.correctOptionIds?.[0] || question.correctOptionIds?.includes?.(o.id) ? '*' : ''}${o.text}`).join(' | ')}`,
                );
              }
              if (question.correctAnswer !== undefined) {
                lines.push(`  answer: ${question.correctAnswer}`);
              }
            }
            break;
          case TrackItemType.JOURNAL:
            for (const prompt of content.prompts ?? [])
              lines.push(`- ${prompt.prompt}`);
            break;
          case TrackItemType.ANNOTATED_ARTIFACT:
            lines.push(
              `labels: ${(content.labels ?? []).map((l: any) => l.text).join(', ')}; lines: ${(content.units ?? []).length}; answers: ${(content.targets ?? []).length}`,
            );
            break;
          case TrackItemType.ROLEPLAY:
            lines.push(`roleplay scenario #${item.scenarioId}`);
            break;
          case TrackItemType.CASE:
            lines.push(`case ${item.caseId}`);
            break;
          default:
            lines.push(JSON.stringify(content).slice(0, 300));
        }
      }
    }
    const digest = lines.join('\n');
    return digest.length > 120_000
      ? `${digest.slice(0, 120_000)}\n…[digest ends here — the course continues; not a defect]`
      : digest;
  }
}
