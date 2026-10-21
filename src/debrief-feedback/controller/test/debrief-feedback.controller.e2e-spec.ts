import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  INestApplication,
  ForbiddenException,
  ValidationPipe,
} from '@nestjs/common';
import * as request from 'supertest';
import { DebriefFeedbackService } from '../../service/debrief-feedback.service';
import { DebriefFeedbackController } from '../debrief-feedback.controller';
import { DebriefFeedback } from '../../entity/debrief-feedback.entity';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ScenarioSessions } from 'src/learn/entity/scenario-sessions.entity';
import { SkillExperimentObservation } from 'src/skill-experiment/entity/skill-experiment-observation.entity';

describe('DebriefFeedbackController (e2e)', () => {
  const sessionId = '6f1c2d3e-4a5b-4c6d-8e7f-901234567890';
  let app: INestApplication;
  let service: jest.Mocked<DebriefFeedbackService>;

  beforeEach(async () => {
    service = {
      createFeedback: jest.fn(),
    } as any;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [DebriefFeedbackController],
      providers: [{ provide: DebriefFeedbackService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue('tenant-1');
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('42');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('POST /v1/scenario-sessions/:sessionId/debrief-feedback (201)', () => {
    const body = { rating: 'positive', comment: 'Great debrief!' };
    service.createFeedback.mockResolvedValue({
      id: 'f-1',
      ...body,
      scenarioSessionId: sessionId,
    } as any);

    return request(app.getHttpServer())
      .post(`/v1/scenario-sessions/${sessionId}/debrief-feedback`)
      .send(body)
      .expect(201)
      .expect((res) => {
        expect(res.body.id).toBe('f-1');
        expect(service.createFeedback).toHaveBeenCalledWith(
          'tenant-1',
          42,
          sessionId,
          'positive',
          'Great debrief!',
        );
      });
  });

  it('POST /v1/scenario-sessions/:sessionId/debrief-feedback (403 passes through)', () => {
    service.createFeedback.mockRejectedValue(
      new ForbiddenException('Only the learner who ran this session'),
    );

    return request(app.getHttpServer())
      .post(`/v1/scenario-sessions/${sessionId}/debrief-feedback`)
      .send({ rating: 'positive' })
      .expect(403);
  });

  it('POST /v1/scenario-sessions/:sessionId/debrief-feedback (400 Bad Request on invalid rating)', () => {
    return request(app.getHttpServer())
      .post(`/v1/scenario-sessions/${sessionId}/debrief-feedback`)
      .send({ rating: 'invalid' })
      .expect(400);
  });

  it('POST /v1/scenario-sessions/:sessionId/debrief-feedback (400 on a non-UUID session id)', () => {
    return request(app.getHttpServer())
      .post('/v1/scenario-sessions/not-a-uuid/debrief-feedback')
      .send({ rating: 'positive' })
      .expect(400)
      .expect(() => expect(service.createFeedback).not.toHaveBeenCalled());
  });

  it('POST /v1/scenario-sessions/:sessionId/debrief-feedback (401 without a user in context)', () => {
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(undefined);

    return request(app.getHttpServer())
      .post(`/v1/scenario-sessions/${sessionId}/debrief-feedback`)
      .send({ rating: 'positive' })
      .expect(401)
      .expect(() => expect(service.createFeedback).not.toHaveBeenCalled());
  });
});

/**
 * The debrief posts twice — the rating on the thumb tap, then the optional
 * comment with the same rating — so this runs the real service over a store
 * that, like the table, holds one row per session.
 */
describe('DebriefFeedbackController (e2e) — rating then comment', () => {
  const sessionId = '6f1c2d3e-4a5b-4c6d-8e7f-901234567890';
  const LEARNER_ID = '42';
  let app: INestApplication;
  let rows: Map<string, DebriefFeedback>;
  let observationUpdate: jest.Mock;

  const post = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/v1/scenario-sessions/${sessionId}/debrief-feedback`)
      .send(body);

  beforeEach(async () => {
    rows = new Map();
    let nextId = 1;
    const feedbackRepo = {
      findOne: jest.fn(async ({ where }) => {
        const row = rows.get(where.scenarioSessionId);
        return row && row.tenantId === where.tenantId ? { ...row } : null;
      }),
      create: jest.fn((x) => ({ ...x })),
      save: jest.fn(async (x) => {
        const current = rows.get(x.scenarioSessionId);
        if (!x.id && current) {
          // debrief_feedback is UNIQUE (scenarioSessionId)
          throw new Error('duplicate key value violates unique constraint');
        }
        const saved = { ...x, id: x.id ?? `f-${nextId++}` };
        rows.set(x.scenarioSessionId, saved);
        return { ...saved };
      }),
    };
    observationUpdate = jest.fn();
    const observationRepo = {
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'obs-1' }),
      })),
      update: observationUpdate,
    };
    const scenarioSessionRepo = {
      findOne: jest.fn(async ({ where }) =>
        where.id === sessionId && where.tenantId === 'tenant-1'
          ? { id: sessionId, counselorId: Number(LEARNER_ID) }
          : null,
      ),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [DebriefFeedbackController],
      providers: [
        DebriefFeedbackService,
        {
          provide: getRepositoryToken(DebriefFeedback),
          useValue: feedbackRepo,
        },
        {
          provide: getRepositoryToken(SkillExperimentObservation),
          useValue: observationRepo,
        },
        {
          provide: getRepositoryToken(ScenarioSessions),
          useValue: scenarioSessionRepo,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue('tenant-1');
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(LEARNER_ID);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('saves the comment posted after the rating (201 twice, one row)', async () => {
    const vote = await post({ rating: 'negative' }).expect(201);
    expect(vote.body.rating).toBe('negative');

    const withComment = await post({
      rating: 'negative',
      comment: 'Too generic to act on.',
    }).expect(201);

    expect(withComment.body).toMatchObject({
      id: vote.body.id,
      rating: 'negative',
      comment: 'Too generic to act on.',
    });
    expect(rows.size).toBe(1);
    expect(rows.get(sessionId)?.comment).toBe('Too generic to act on.');
    // The observation is judged by the rating, once.
    expect(observationUpdate).toHaveBeenCalledTimes(1);
    expect(observationUpdate).toHaveBeenCalledWith(
      'obs-1',
      expect.objectContaining({ score: 0 }),
    );
  });

  it('keeps the first rating when a later post carries a different one', async () => {
    await post({ rating: 'positive' }).expect(201);

    const res = await post({ rating: 'negative', comment: 'Hmm' }).expect(201);

    expect(res.body.rating).toBe('positive');
    expect(rows.get(sessionId)?.rating).toBe('positive');
    expect(observationUpdate).toHaveBeenCalledTimes(1);
  });

  it("still refuses a comment on someone else's session (403)", async () => {
    await post({ rating: 'positive' }).expect(201);
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue('7');

    await post({ rating: 'positive', comment: 'Not mine' }).expect(403);

    expect(rows.get(sessionId)?.comment).toBeUndefined();
  });
});
