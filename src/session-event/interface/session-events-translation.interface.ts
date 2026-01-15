export interface CreateSessionEventTranslation {
  sessionEventId: string;
  languageId: number;
  name: string;
  message: string;
  branchInstruction: string;
  detectionData?: Record<string, any>;
}

export interface UpdateSessionEventTranslation extends CreateSessionEventTranslation {}
