import { Test, TestingModule } from '@nestjs/testing';
import { ParticipantInfo_Kind } from '@livekit/protocol';
import {
  ParticipantLeftHandler,
  ParticipantLeftEvent,
} from '../participant-left.handler';
import { ScenarioSessionService } from 'src/learn/service/scenario-session.service';
import { ScenarioSessionLifecycleEventType } from 'src/learn/entity/scenario-session-lifecycle-event.entity';

describe('ParticipantLeftHandler', () => {
  let handler: ParticipantLeftHandler;
  let scenarioSessionService: jest.Mocked<ScenarioSessionService>;

  const event = (
    kind: number,
    name = 'ss_session-123',
  ): ParticipantLeftEvent => ({
    event: 'participant_left',
    room: { name, sid: 'room-sid' },
    participant: { sid: 'p-sid', identity: 'AgentIdentity', kind },
    id: 'evt-1',
    created_at: Date.now(),
  });

  beforeEach(async () => {
    const mockScenarioSessionService = {
      sessionIdFromRoomName: jest.fn((n: string) =>
        n?.startsWith('ss_') ? n.slice(3) : null,
      ),
      recordLifecycleEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParticipantLeftHandler,
        {
          provide: ScenarioSessionService,
          useValue: mockScenarioSessionService,
        },
      ],
    }).compile();

    handler = module.get(ParticipantLeftHandler);
    scenarioSessionService = module.get(ScenarioSessionService);
  });

  it('records AGENT_LEFT when the agent leaves', async () => {
    await handler.handle(event(ParticipantInfo_Kind.AGENT));

    expect(scenarioSessionService.recordLifecycleEvent).toHaveBeenCalledWith(
      'session-123',
      ScenarioSessionLifecycleEventType.AGENT_LEFT,
      expect.any(Date),
      { identity: 'AgentIdentity' },
    );
  });

  it('ignores non-agent (human) participants leaving', async () => {
    await handler.handle(event(ParticipantInfo_Kind.STANDARD));
    expect(scenarioSessionService.recordLifecycleEvent).not.toHaveBeenCalled();
  });

  it('ignores rooms whose name is not a session room', async () => {
    await handler.handle(event(ParticipantInfo_Kind.AGENT, 'preview-abc'));
    expect(scenarioSessionService.recordLifecycleEvent).not.toHaveBeenCalled();
  });
});
