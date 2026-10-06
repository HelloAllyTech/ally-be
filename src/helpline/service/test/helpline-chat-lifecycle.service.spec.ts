import { HELPLINE_DEFAULT_SETTINGS } from '../../constants/helpline-settings.defaults';
import {
  HelplineChatEventType,
  HelplineEndedReason,
  HelplineGuestSystemKind,
  HelplineServerEvents,
} from '../../constants/helpline.constants';
import { HelplineChatLifecycleService } from '../helpline-chat-lifecycle.service';

const base = {
  id: 'c-1',
  tenantId: 't-1',
  language: 'hi',
  listenerId: 7,
  claimedAt: new Date('2026-10-05T10:00:00Z'),
  waitStartedAt: new Date('2026-10-05T09:58:00Z'),
  endedAt: new Date('2026-10-05T10:30:00Z'),
  talkerMessageCount: 5,
  listenerMessageCount: 4,
};

function build(ended = true, chatOverrides: Record<string, unknown> = {}) {
  const fresh = { ...base, ...chatOverrides };
  const deps = {
    chats: {
      markEnded: jest.fn().mockResolvedValue(ended),
      findById: jest.fn().mockResolvedValue(fresh),
    },
    writer: { system: jest.fn().mockResolvedValue({}) },
    events: { record: jest.fn().mockResolvedValue(undefined) },
    notify: {
      chatUpdated: jest.fn().mockResolvedValue(undefined),
      presenceUpdated: jest.fn().mockResolvedValue(undefined),
    },
    queue: { queueChanged: jest.fn() },
    realtime: { emit: jest.fn().mockResolvedValue(undefined) },
    summaries: { scheduleFinal: jest.fn() },
    settings: {
      getSettings: jest.fn().mockResolvedValue(HELPLINE_DEFAULT_SETTINGS),
      defaults: HELPLINE_DEFAULT_SETTINGS,
    },
    tenants: {
      resolve: jest.fn().mockResolvedValue({ id: 't-1', code: 'acme' }),
    },
    copilot: { onChatEnded: jest.fn() },
  };
  const service = new HelplineChatLifecycleService(
    deps.chats as never,
    deps.writer as never,
    deps.events as never,
    deps.notify as never,
    deps.queue as never,
    deps.realtime as never,
    deps.summaries as never,
    deps.settings as never,
    deps.tenants as never,
    deps.copilot as never,
  );
  return { service, fresh, ...deps };
}

describe('HelplineChatLifecycleService.endChat', () => {
  it('is a no-op when the chat was already ended (the conditional UPDATE lost)', async () => {
    const { service, events, writer, realtime, summaries } = build(false);
    await service.endChat(base as never, HelplineEndedReason.LISTENER_ENDED, 7);
    expect(events.record).not.toHaveBeenCalled();
    expect(writer.system).not.toHaveBeenCalled();
    expect(realtime.emit).not.toHaveBeenCalled();
    expect(summaries.scheduleFinal).not.toHaveBeenCalled();
  });

  it('a listener end: ENDED event, org CLOSING text in the talker’s language, CHAT_ENDED to both rooms, FINAL summary', async () => {
    const { service, events, writer, realtime, summaries, queue } = build();
    await service.endChat(base as never, HelplineEndedReason.LISTENER_ENDED, 7);
    expect(events.record).toHaveBeenCalledWith(
      't-1',
      'c-1',
      HelplineChatEventType.ENDED,
      7,
      { reason: HelplineEndedReason.LISTENER_ENDED },
    );
    expect(writer.system).toHaveBeenCalledWith(
      expect.anything(),
      HelplineGuestSystemKind.CLOSING,
      HELPLINE_DEFAULT_SETTINGS.closingMessage.hi,
      { visibleToTalker: true },
    );
    const rooms = realtime.emit.mock.calls
      .filter(([, event]) => event === HelplineServerEvents.CHAT_ENDED)
      .map(([room]) => room);
    expect(rooms).toEqual(['talker:c-1', 'staff:c-1']);
    expect(summaries.scheduleFinal).toHaveBeenCalled();
    expect(queue.queueChanged).toHaveBeenCalledWith('t-1');
  });

  it('falls back to the English closing text for a language the org has not written', async () => {
    const { service, writer } = build(true, { language: 'ta' });
    await service.endChat(
      { ...base, language: 'ta' } as never,
      HelplineEndedReason.SUPERVISOR_ENDED,
      9,
    );
    expect(writer.system.mock.calls[0][2]).toBe(
      HELPLINE_DEFAULT_SETTINGS.closingMessage.en,
    );
  });

  it('a talker end gets a plain ENDED notice, not the org closing text', async () => {
    const { service, writer } = build();
    await service.endChat(base as never, HelplineEndedReason.TALKER_ENDED);
    expect(writer.system.mock.calls[0][1]).toBe(HelplineGuestSystemKind.ENDED);
  });

  it('erasure writes no notice and generates no summary', async () => {
    const { service, writer, summaries } = build();
    await service.endChat(base as never, HelplineEndedReason.TALKER_ERASED);
    expect(writer.system).not.toHaveBeenCalled();
    expect(summaries.scheduleFinal).not.toHaveBeenCalled();
  });

  it('a chat nobody claimed gets no summary', async () => {
    const { service, summaries } = build(true, {
      claimedAt: null,
      listenerId: null,
    });
    await service.endChat(base as never, HelplineEndedReason.WAIT_EXPIRED);
    expect(summaries.scheduleFinal).not.toHaveBeenCalled();
  });
});
