export interface CreateSessionEventTranslation {
  sessionEventId: string;
  languageId: number;
  message: string;
  branchInstruction: string;
  detectionData?: Record<string, any>;
}

export interface UpdateSessionEventTranslation
  extends CreateSessionEventTranslation {}
