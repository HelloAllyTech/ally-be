export interface CreateSessionEventTranslation {
  sessionEventId: string;
  languageId: number;
  name: string;
  message: string;
  branchInstruction: string;
}

export interface UpdateSessionEventTranslation
  extends CreateSessionEventTranslation {}
