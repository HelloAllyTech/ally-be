import {
  HelplineChatStatus,
  HelplineEndedReason,
} from '../../constants/helpline.constants';
import {
  SweepChatState,
  SweepContext,
  decideSweepActions,
} from '../helpline-lifecycle-decisions';

const NOW = new Date('2026-10-05T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const SEC = 1000;
const MIN = 60 * SEC;

const waiting = (o: Partial<SweepChatState> = {}): SweepChatState => ({
  status: HelplineChatStatus.WAITING,
  waitStartedAt: ago(5 * MIN),
  abandonedAt: null,
  listenerId: null,
  ...o,
});
const active = (o: Partial<SweepChatState> = {}): SweepChatState => ({
  status: HelplineChatStatus.ACTIVE,
  waitStartedAt: ago(20 * MIN),
  abandonedAt: null,
  listenerId: 7,
  ...o,
});
const ctx = (o: Partial<SweepContext> = {}): SweepContext => ({
  now: NOW,
  maxWaitMinutes: 30,
  idleEndMinutes: 15,
  talkerGoneSince: null,
  listenerGoneSince: null,
  reconnectingSent: false,
  listenerFlagged: false,
  alertSent: false,
  ...o,
});

describe('decideSweepActions (contract §6.5)', () => {
  describe('WAITING', () => {
    it('ends a wait past maxWaitMinutes, even with the talker connected', () => {
      expect(
        decideSweepActions(waiting({ waitStartedAt: ago(31 * MIN) }), ctx()),
      ).toEqual([{ type: 'END', reason: HelplineEndedReason.WAIT_EXPIRED }]);
    });

    it('does nothing for a connected talker inside the wait limit', () => {
      expect(decideSweepActions(waiting(), ctx())).toEqual([]);
    });

    it('marks abandoned once the talker has been gone 2 minutes, not before', () => {
      expect(
        decideSweepActions(waiting(), ctx({ talkerGoneSince: ago(119 * SEC) })),
      ).toEqual([]);
      expect(
        decideSweepActions(waiting(), ctx({ talkerGoneSince: ago(2 * MIN) })),
      ).toEqual([{ type: 'MARK_ABANDONED' }]);
    });

    it('ends QUEUE_ABANDONED 10 minutes after abandonment', () => {
      const chat = waiting({ abandonedAt: ago(10 * MIN + SEC) });
      expect(
        decideSweepActions(chat, ctx({ talkerGoneSince: ago(13 * MIN) })),
      ).toEqual([{ type: 'END', reason: HelplineEndedReason.QUEUE_ABANDONED }]);
      expect(
        decideSweepActions(
          waiting({ abandonedAt: ago(9 * MIN) }),
          ctx({ talkerGoneSince: ago(11 * MIN) }),
        ),
      ).toEqual([]);
    });

    it('revives an abandoned wait when the talker is back (original wait_started_at keeps their place)', () => {
      expect(
        decideSweepActions(waiting({ abandonedAt: ago(3 * MIN) }), ctx()),
      ).toEqual([{ type: 'CLEAR_ABANDONED' }]);
    });
  });

  describe('ACTIVE', () => {
    it('ends TALKER_DISCONNECTED after idleEndMinutes without the talker', () => {
      expect(
        decideSweepActions(active(), ctx({ talkerGoneSince: ago(15 * MIN) })),
      ).toEqual([
        { type: 'END', reason: HelplineEndedReason.TALKER_DISCONNECTED },
      ]);
      expect(
        decideSweepActions(active(), ctx({ talkerGoneSince: ago(14 * MIN) })),
      ).toEqual([]);
    });

    it('tells the talker the listener is reconnecting after 30 s, once', () => {
      expect(
        decideSweepActions(active(), ctx({ listenerGoneSince: ago(29 * SEC) })),
      ).toEqual([]);
      expect(
        decideSweepActions(active(), ctx({ listenerGoneSince: ago(30 * SEC) })),
      ).toEqual([{ type: 'LISTENER_RECONNECTING' }]);
      expect(
        decideSweepActions(
          active(),
          ctx({ listenerGoneSince: ago(40 * SEC), reconnectingSent: true }),
        ),
      ).toEqual([]);
    });

    it('flags the listener to staff at 3 minutes and alerts supervisors at 10, once each', () => {
      expect(
        decideSweepActions(
          active(),
          ctx({ listenerGoneSince: ago(3 * MIN), reconnectingSent: true }),
        ),
      ).toEqual([{ type: 'LISTENER_GONE_FLAG' }]);
      expect(
        decideSweepActions(
          active(),
          ctx({
            listenerGoneSince: ago(10 * MIN),
            reconnectingSent: true,
            listenerFlagged: true,
          }),
        ),
      ).toEqual([{ type: 'LISTENER_GONE_ALERT' }]);
      expect(
        decideSweepActions(
          active(),
          ctx({
            listenerGoneSince: ago(20 * MIN),
            reconnectingSent: true,
            listenerFlagged: true,
            alertSent: true,
          }),
        ),
      ).toEqual([]);
    });

    it('does everything at once when the sweep first sees a long gap (crashed replica)', () => {
      expect(
        decideSweepActions(active(), ctx({ listenerGoneSince: ago(11 * MIN) })),
      ).toEqual([
        { type: 'LISTENER_RECONNECTING' },
        { type: 'LISTENER_GONE_FLAG' },
        { type: 'LISTENER_GONE_ALERT' },
      ]);
    });

    it('says the listener is back, and clears the staff flag, when they return', () => {
      expect(
        decideSweepActions(
          active(),
          ctx({ reconnectingSent: true, listenerFlagged: true }),
        ),
      ).toEqual([{ type: 'LISTENER_BACK' }, { type: 'LISTENER_GONE_CLEAR' }]);
    });

    it('a talker timeout wins over listener notices', () => {
      expect(
        decideSweepActions(
          active(),
          ctx({
            talkerGoneSince: ago(16 * MIN),
            listenerGoneSince: ago(16 * MIN),
          }),
        ),
      ).toEqual([
        { type: 'END', reason: HelplineEndedReason.TALKER_DISCONNECTED },
      ]);
    });
  });

  it('never acts on an ENDED chat', () => {
    expect(
      decideSweepActions(
        { ...active(), status: HelplineChatStatus.ENDED },
        ctx({
          talkerGoneSince: ago(60 * MIN),
          listenerGoneSince: ago(60 * MIN),
        }),
      ),
    ).toEqual([]);
  });
});
