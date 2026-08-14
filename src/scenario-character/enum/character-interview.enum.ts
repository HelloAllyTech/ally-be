export enum CharacterInterviewSessionStatus {
  ACTIVE = 'ACTIVE',
  // The agent called save_character_draft — draftCharacter is populated and
  // the session is done (the human reviews/saves in the character form).
  COMPLETED = 'COMPLETED',
}

export enum CharacterInterviewMessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
}
