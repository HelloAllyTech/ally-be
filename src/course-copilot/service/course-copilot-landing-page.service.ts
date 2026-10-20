import { BadGatewayException, Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { LoggerService } from 'src/logger/logger.service';
import {
  TRACK_TRIGGER_WARNINGS_BY_SECTION_SQL,
  TrackSectionTriggerWarningRow,
} from 'src/track/constants/track-landing-page.constant';
import { TrackSharedService } from 'src/track/service/track-shared.service';
import { TrackItemType } from 'src/track/type/track.type';
import { TrackLandingPage } from 'src/track/type/track-landing-page.type';
import { normaliseTrackLandingPage } from 'src/track/util/track-landing-page.util';
import { LandingPageSpecialist } from './specialists/landing-page.specialist';
import {
  LandingPageSectionInput,
  SpecialistValidationError,
} from './specialists/specialist.types';
import { htmlToText, truncateAtWord } from './specialists/specialist.util';

const COURSE_DESCRIPTION_MAX_CHARS = 1500;

export const LANDING_PAGE_DRAFT_UNREADABLE_MESSAGE =
  'Course Copilot drafted something it could not turn into a landing page, ' +
  'even after a second try. Try again, or fill the page in by hand.';
export const LANDING_PAGE_DRAFT_FAILED_MESSAGE =
  'Course Copilot could not draft the landing page right now. Try again in a ' +
  'moment.';

/**
 * Gathers what the landing-page writer reads — the SAVED course, not whatever
 * is open in the builder — and hands it to the specialist.
 *
 * Read-only. Nothing the model returns is written anywhere: the builder merges
 * the draft into the fields its author left empty, and the author saves the
 * page like any other edit, through the same PUT that validates and normalises
 * it. That is why this needs no session, no lock and no budget row.
 */
@Injectable()
export class CourseCopilotLandingPageService {
  private readonly logger = LoggerService.getInstance(
    CourseCopilotLandingPageService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly trackSharedService: TrackSharedService,
    private readonly landingPageSpecialist: LandingPageSpecialist,
  ) {}

  /**
   * @throws NotFoundException when the course does not exist.
   * @throws BadGatewayException, with a readable message, when the model's
   *   answer cannot be used after the one repair pass or the call fails.
   */
  async draft(trackId: string): Promise<{ draft: TrackLandingPage }> {
    const track = await this.trackSharedService.getTrackWithStructure(trackId);

    const items = track.sections.flatMap((section) => section.items);
    const scenarioIds = [
      ...new Set(
        items
          .filter((item) => item.type === TrackItemType.ROLEPLAY)
          .map((item) => item.scenarioId)
          .filter((id): id is number => typeof id === 'number'),
      ),
    ];
    const hasScenarioItems = items.some(
      (item) =>
        item.type === TrackItemType.ROLEPLAY ||
        item.type === TrackItemType.CASE,
    );

    const [scenarios, warningRows] = await Promise.all([
      scenarioIds.length
        ? this.dataSource.getRepository(Scenarios).find({
            where: { id: In(scenarioIds) },
            select: {
              id: true,
              title: true,
              description: true,
              scenario: true,
            },
          })
        : Promise.resolve([]),
      hasScenarioItems
        ? (this.dataSource.query(TRACK_TRIGGER_WARNINGS_BY_SECTION_SQL, [
            trackId,
          ]) as Promise<TrackSectionTriggerWarningRow[]>)
        : Promise.resolve([] as TrackSectionTriggerWarningRow[]),
    ]);
    const scenarioById = new Map(
      scenarios.map((scenario) => [scenario.id, scenario]),
    );

    const sections: LandingPageSectionInput[] = track.sections.map(
      (section) => ({
        id: section.id,
        title: section.title,
        description: section.description,
        items: section.items.map((item) => {
          const scenario =
            item.type === TrackItemType.ROLEPLAY && item.scenarioId
              ? scenarioById.get(item.scenarioId)
              : undefined;
          return {
            type: item.type,
            title: item.title,
            description: item.description,
            ...(scenario
              ? {
                  scenario: {
                    title: scenario.title,
                    // The learner-facing story and summary; never the actor's
                    // prompt, which holds the client's hidden events.
                    story: [scenario.description, scenario.scenario]
                      .filter(Boolean)
                      .join(' '),
                  },
                }
              : {}),
          };
        }),
      }),
    );

    try {
      const draft = await this.landingPageSpecialist.generate({
        trackId,
        title: track.title,
        description: truncateAtWord(
          htmlToText(track.description ?? ''),
          COURSE_DESCRIPTION_MAX_CHARS,
        ),
        durationMinutes: track.estimatedDurationMinutes,
        sections,
        triggerWarnings: groupWarnings(warningRows),
        currentPage: track.landingPage
          ? normaliseTrackLandingPage(track.landingPage)
          : null,
        usageMetadata: { trackId, specialist: 'landing_page' },
      });
      return { draft };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Landing page draft failed for track ${trackId}: ${detail}`,
      );
      throw new BadGatewayException(
        error instanceof SpecialistValidationError
          ? LANDING_PAGE_DRAFT_UNREADABLE_MESSAGE
          : LANDING_PAGE_DRAFT_FAILED_MESSAGE,
      );
    }
  }
}

/** Distinct English names, each with the sections that carry it. */
function groupWarnings(
  rows: TrackSectionTriggerWarningRow[],
): { name: string; sectionIds: string[] }[] {
  const byName = new Map<string, Set<string>>();
  for (const row of rows) {
    const name = row.name?.trim();
    if (!name) continue;
    byName.set(name, (byName.get(name) ?? new Set()).add(row.sectionId));
  }
  return [...byName].map(([name, sectionIds]) => ({
    name,
    sectionIds: [...sectionIds],
  }));
}
