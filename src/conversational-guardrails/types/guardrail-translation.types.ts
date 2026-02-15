export interface GuardrailMetadata {
  helperDialogue: string;
  actorDialogue: string;
}

export interface CreateGuardrailTranslation {
  guardrailId: string;
  languageId: number;
  helperDialogue: string;
  actorDialogue: string;
}

export interface CreateConversationalGuardrailTranslation {
  guardrailId: string;
  languageId: number;
  helperDialogue: string;
  actorDialogue: string;
}

export interface UpdateConversationalGuardrailTranslation {
  helperDialogue?: string;
  actorDialogue?: string;
}
