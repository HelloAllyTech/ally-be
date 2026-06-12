/**
 * Which classifier/detection logic a guardrail uses. Independent of `kind`
 * (governance: USER/SYSTEM). A guardrail can be any kind with any detectorType.
 * - CATEGORY: "does the utterance match this behavior category?" (fires on
 *   coherent matching content) — uses the shared guardrail classifier.
 * - COHERENCE: "is the utterance gibberish / out-of-context?" (must NOT fire on
 *   coherent content) — uses the dedicated coherence classifier.
 */
export enum ConversationalGuardrailDetectorType {
  CATEGORY = 'CATEGORY',
  COHERENCE = 'COHERENCE',
}
