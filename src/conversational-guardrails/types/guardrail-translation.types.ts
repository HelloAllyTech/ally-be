import { ConversationalGuardrailKind } from '../enum/conversational-guardrails-kind.enum';
import { ConversationalGuardrailDetectorType } from '../enum/conversational-guardrails-detector-type.enum';

export interface GuardrailMetadata {
  helperDialogue: string;
  actorDialogue: string;
  // Governance (USER/SYSTEM) — surfaced for completeness; the agent does not
  // route on this.
  kind: ConversationalGuardrailKind;
  // The agent routes the classifier on this: COHERENCE -> dedicated coherence
  // classifier, CATEGORY -> shared classifier.
  detectorType: ConversationalGuardrailDetectorType;
}
