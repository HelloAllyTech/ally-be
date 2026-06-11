import { ConversationalGuardrailKind } from '../enum/conversational-guardrails-kind.enum';

export interface GuardrailMetadata {
  helperDialogue: string;
  actorDialogue: string;
  // SYSTEM guardrails route to the dedicated coherence classifier in the agent;
  // USER guardrails use the shared category classifier.
  kind: ConversationalGuardrailKind;
}
