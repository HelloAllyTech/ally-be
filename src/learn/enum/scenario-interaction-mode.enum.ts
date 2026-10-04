/**
 * How the learner and the simulated client talk during a roleplay.
 *
 * VOICE is the original and default mode: a LiveKit call with STT and TTS.
 * TEXT runs the same persona, events, guardrails and scoring through the same
 * LiveKit room with audio switched off — the learner types, the client types
 * back. It exists to train text-based helpline staff, and is reachable only
 * when BOTH the org preference `TEXT_CHAT_ROLEPLAY_ENABLED` and the scenario's
 * `metadata.textChatEnabled` are on; see `ScenarioSessionService.assertTextChatAllowed`.
 */
export enum ScenarioInteractionMode {
  VOICE = 'VOICE',
  TEXT = 'TEXT',
}
