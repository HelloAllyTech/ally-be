/**
 * Lifecycle state of a roleplay session.
 *
 * `ABANDONED` is the third state, added because a crashed roleplay was
 * previously indistinguishable from a finished one: everything that stopped
 * running was `ENDED`, so a session whose agent died mid-conversation, whose
 * learner's connection dropped, or which was reaped after sitting `ACTIVE`
 * forever, all read exactly like a learner who worked through a scenario and
 * clicked End.
 *
 * WHY IT IS SAFE TO ADD (worth stating, because ~20 analytics repositories read
 * these columns): every write introduced with this state moves a row from a
 * value the analytics filters ALREADY exclude to another they exclude.
 * `status = 'ABANDONED'` is only ever set on a row that was `ACTIVE`, and every
 * analytics query keys on `status = 'ENDED'`. So no number on any dashboard
 * moves; the state is a pure gain in what we can SEE.
 */
export enum ScenarioSessionStatus {
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
  /**
   * The session stopped without ever being ended. Terminal, like ENDED, but
   * asserting the opposite about how it got there. Set by the stuck-session
   * sweeper on rows that were left ACTIVE with no possibility of resuming.
   */
  ABANDONED = 'ABANDONED',
}

/**
 * Did the session complete its post-session lifecycle (summary, score,
 * progress)?
 *
 * `COMPLETED` is written from exactly one place — `handleEndScenarioSessionEvent`,
 * i.e. off the agent's `end-of-session` SQS message. So `IN_PROGRESS` has always
 * meant two very different things: "still running" and "stopped, and that
 * message never came". `ABANDONED` separates the second one out for the case
 * where we can actually PROVE it — the room closed while the session had not
 * been ended by anyone.
 *
 * Same safety argument as above: analytics filters on `= 'COMPLETED'`, and these
 * rows were `IN_PROGRESS`, so nothing they count changes.
 */
export enum ScenarioSessionEventStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  /** Reached a terminal end without completing the post-session lifecycle. */
  ABANDONED = 'ABANDONED',
}

/**
 * Why a session was marked abandoned. Stored in
 * `scenario_sessions.abandonedReason`.
 *
 * A bare ABANDONED flag would only relocate the ambiguity it was added to
 * remove — "the room died" and "nobody ever closed this out" need different
 * responses from whoever reads it.
 */
export enum ScenarioSessionAbandonReason {
  /**
   * The LiveKit room closed while the session was still ACTIVE. Nobody ended
   * it: the agent died, the learner's connection dropped, or LiveKit's
   * empty-timeout fired.
   */
  ROOM_FINISHED_WITHOUT_END = 'ROOM_FINISHED_WITHOUT_END',
  /**
   * Reaped by the sweeper after sitting ACTIVE well past any plausible session
   * length. Nothing is coming for it — no room, no agent, no webhook.
   */
  STUCK_ACTIVE_SWEEP = 'STUCK_ACTIVE_SWEEP',
  /**
   * The agent's lifecycle message failed permanently (dead-lettered), so the
   * session can never be closed out from that path.
   */
  LIFECYCLE_MESSAGE_DEAD_LETTERED = 'LIFECYCLE_MESSAGE_DEAD_LETTERED',
}
