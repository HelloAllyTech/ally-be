export type SessionEventMetadata = {
  name?: string | null;
  message?: string | null;
  branchInstruction?: string | null;
  detectionData?: Record<string, any> | null;
};
