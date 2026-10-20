import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { TrackItemType } from 'src/track/type/track.type';
import { normaliseTrackLandingPage } from 'src/track/util/track-landing-page.util';
import {
  CourseCopilotLandingPageService,
  LANDING_PAGE_DRAFT_FAILED_MESSAGE,
  LANDING_PAGE_DRAFT_UNREADABLE_MESSAGE,
} from '../course-copilot-landing-page.service';
import { SpecialistValidationError } from '../specialists/specialist.types';

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => ({
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    })),
  },
}));

const TRACK_ID = '7b0c3c52-2f7a-4c2a-9a55-0e4d6f1d2a11';

describe('CourseCopilotLandingPageService', () => {
  const scenarioRepo = { find: jest.fn() };
  const dataSource = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === Scenarios) return scenarioRepo;
      throw new Error(`unexpected repository ${String(entity)}`);
    }),
    query: jest.fn(),
  };
  const trackSharedService = { getTrackWithStructure: jest.fn() };
  const specialist = { generate: jest.fn() };

  const service = new CourseCopilotLandingPageService(
    dataSource as any,
    trackSharedService as any,
    specialist as any,
  );

  const track = (overrides: Record<string, unknown> = {}) => ({
    id: TRACK_ID,
    title: 'Staying with the texter',
    description: '<p>For new <b>volunteers</b>.</p>',
    estimatedDurationMinutes: 40,
    landingPage: null,
    sections: [
      {
        id: 'sec-1',
        title: 'Listening first',
        description: null,
        items: [
          {
            type: TrackItemType.ARTICLE,
            title: 'Name the feeling',
            description: null,
            scenarioId: null,
            caseId: null,
            // Content must never reach the writer.
            content: { html: 'SECRET ARTICLE BODY' },
          },
          {
            type: TrackItemType.ROLEPLAY,
            title: 'Asha goes quiet',
            description: null,
            scenarioId: 17,
            caseId: null,
          },
        ],
      },
      {
        id: 'sec-2',
        title: 'A long case',
        description: 'Several calls',
        items: [
          {
            type: TrackItemType.CASE,
            title: 'The week of exams',
            description: null,
            scenarioId: null,
            caseId: 'case-1',
          },
          {
            type: TrackItemType.QUIZ,
            title: 'Check yourself',
            description: null,
            scenarioId: null,
            caseId: null,
            content: {
              questions: [
                { prompt: 'SECRET QUESTION', correctOptionIds: ['a'] },
              ],
            },
          },
        ],
      },
    ],
    ...overrides,
  });

  const draft = normaliseTrackLandingPage({ hero: { hook: 'Hook' } });

  beforeEach(() => {
    jest.clearAllMocks();
    trackSharedService.getTrackWithStructure.mockResolvedValue(track());
    scenarioRepo.find.mockResolvedValue([
      {
        id: 17,
        title: 'Asha, 19',
        description: 'A student late at night.',
        scenario: 'She texts after a bad exam.',
        // The actor's prompt holds hidden events; it is never selected.
        prompt: 'SECRET ACTOR PROMPT',
      },
    ]);
    dataSource.query.mockResolvedValue([]);
    specialist.generate.mockResolvedValue(draft);
  });

  it('returns the specialist’s draft as { draft } and saves nothing', async () => {
    await expect(service.draft(TRACK_ID)).resolves.toEqual({ draft });
  });

  it('404s when the course does not exist', async () => {
    trackSharedService.getTrackWithStructure.mockRejectedValue(
      new NotFoundException('Track not found'),
    );

    await expect(service.draft(TRACK_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(specialist.generate).not.toHaveBeenCalled();
  });

  it('hands the specialist the saved course: sections in order, scenario summaries, plain-text description', async () => {
    await service.draft(TRACK_ID);

    const input = specialist.generate.mock.calls[0][0];
    expect(input).toMatchObject({
      trackId: TRACK_ID,
      title: 'Staying with the texter',
      description: 'For new volunteers .',
      durationMinutes: 40,
      currentPage: null,
      usageMetadata: { trackId: TRACK_ID, specialist: 'landing_page' },
    });
    expect(input.sections.map((s: any) => s.id)).toEqual(['sec-1', 'sec-2']);
    expect(input.sections[0].items[1]).toMatchObject({
      type: 'ROLEPLAY',
      title: 'Asha goes quiet',
      scenario: {
        title: 'Asha, 19',
        story: 'A student late at night. She texts after a bad exam.',
      },
    });
    // Only roleplays carry a scenario.
    expect(input.sections[0].items[0]).not.toHaveProperty('scenario');
  });

  it('never passes item content, quiz questions or the actor prompt', async () => {
    await service.draft(TRACK_ID);

    const serialised = JSON.stringify(specialist.generate.mock.calls[0][0]);
    expect(serialised).not.toContain('SECRET');
    expect(scenarioRepo.find.mock.calls[0][0].select).toEqual({
      id: true,
      title: true,
      description: true,
      scenario: true,
    });
  });

  it('reads scenarios and warnings with one query each, not per item', async () => {
    await service.draft(TRACK_ID);

    expect(scenarioRepo.find).toHaveBeenCalledTimes(1);
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect(dataSource.query.mock.calls[0][1]).toEqual([TRACK_ID]);
  });

  it('groups warnings into distinct names with the sections that carry them', async () => {
    dataSource.query.mockResolvedValue([
      { sectionId: 'sec-1', name: 'Suicide', translations: null },
      { sectionId: 'sec-2', name: 'Suicide', translations: null },
      { sectionId: 'sec-2', name: ' Grief ', translations: null },
      { sectionId: 'sec-2', name: '', translations: null },
    ]);

    await service.draft(TRACK_ID);

    expect(specialist.generate.mock.calls[0][0].triggerWarnings).toEqual([
      { name: 'Suicide', sectionIds: ['sec-1', 'sec-2'] },
      { name: 'Grief', sectionIds: ['sec-2'] },
    ]);
  });

  it('skips both lookups for a course with no roleplays or cases', async () => {
    trackSharedService.getTrackWithStructure.mockResolvedValue(
      track({
        sections: [
          {
            id: 'sec-1',
            title: 'Reading',
            description: null,
            items: [
              {
                type: TrackItemType.ARTICLE,
                title: 'Name the feeling',
                scenarioId: null,
                caseId: null,
              },
            ],
          },
        ],
      }),
    );

    await service.draft(TRACK_ID);

    expect(scenarioRepo.find).not.toHaveBeenCalled();
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('passes the saved landing page, normalised, so a partial page stays consistent', async () => {
    trackSharedService.getTrackWithStructure.mockResolvedValue(
      track({
        landingPage: {
          hero: { hook: '  Existing  ' },
          persona: { name: 'Meera' },
        },
      }),
    );

    await service.draft(TRACK_ID);

    const { currentPage } = specialist.generate.mock.calls[0][0];
    expect(currentPage.hero.hook).toBe('Existing');
    expect(currentPage.persona.name).toBe('Meera');
    expect(currentPage.firstMove.enabled).toBe(true);
  });

  it('answers 502 with a readable message when the output is unusable after the repair pass', async () => {
    specialist.generate.mockRejectedValue(
      new SpecialistValidationError(['The model did not return JSON']),
    );

    const error = await service.draft(TRACK_ID).catch((caught) => caught);

    expect(error).toBeInstanceOf(BadGatewayException);
    expect(error.message).toBe(LANDING_PAGE_DRAFT_UNREADABLE_MESSAGE);
  });

  it('answers 502 with a different readable message when the model call itself fails', async () => {
    specialist.generate.mockRejectedValue(new Error('provider down'));

    const error = await service.draft(TRACK_ID).catch((caught) => caught);

    expect(error).toBeInstanceOf(BadGatewayException);
    expect(error.message).toBe(LANDING_PAGE_DRAFT_FAILED_MESSAGE);
    expect(error.message).not.toContain('provider down');
  });
});
