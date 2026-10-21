import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ConflictException,
  ValidationPipe,
} from '@nestjs/common';
import * as request from 'supertest';
import { DebriefFeedbackService } from '../../service/debrief-feedback.service';
import { DebriefFeedbackController } from '../debrief-feedback.controller';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

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

  it('POST /v1/scenario-sessions/:sessionId/debrief-feedback (409 Conflict)', () => {
    service.createFeedback.mockRejectedValue(
      new ConflictException('Feedback already exists'),
    );

    return request(app.getHttpServer())
      .post(`/v1/scenario-sessions/${sessionId}/debrief-feedback`)
      .send({ rating: 'positive' })
      .expect(409);
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
