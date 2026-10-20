import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ConflictException } from '@nestjs/common';
import * as request from 'supertest';
import { DebriefFeedbackService } from '../../service/debrief-feedback.service';
import { DebriefFeedbackController } from '../debrief-feedback.controller';
import { ExecutionManager } from 'src/common/execution/execution-manager';

describe('DebriefFeedbackController (e2e)', () => {
  let app: INestApplication;
  let service: jest.Mocked<DebriefFeedbackService>;

  beforeEach(async () => {
    service = {
      createFeedback: jest.fn(),
    } as any;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [DebriefFeedbackController],
      providers: [{ provide: DebriefFeedbackService, useValue: service }],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue('tenant-1');
  });

  it('POST /v1/scenario-sessions/:sessionId/debrief-feedback (201)', () => {
    const sessionId = 'sess-1';
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
          sessionId,
          'positive',
          'Great debrief!',
        );
      });
  });

  it('POST /v1/scenario-sessions/:sessionId/debrief-feedback (409 Conflict)', () => {
    const sessionId = 'sess-1';
    service.createFeedback.mockRejectedValue(
      new ConflictException('Feedback already exists'),
    );

    return request(app.getHttpServer())
      .post(`/v1/scenario-sessions/${sessionId}/debrief-feedback`)
      .send({ rating: 'positive' })
      .expect(409);
  });
});
