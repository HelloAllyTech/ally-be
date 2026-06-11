export type ScenarioReportConfig = {
  helperAgentPrompt: string;
  languageId: number;
  turns: number;
  /**
   * promptCode of the main-agent prompt variant (the "skill") the scenario
   * was running when this report was generated. Snapshotted here at
   * creation time so the report history can show which skill produced each
   * report even after the scenario later switches to a different variant.
   * Undefined for reports generated before this was captured, or when the
   * scenario was on the default variant.
   */
  selectedMainPromptCode?: string;
  /**
   * promptCode of the transcript-evaluator prompt variant chosen to score this
   * report. Snapshotted at creation time so history records which evaluator
   * variant produced each report. Undefined means the default evaluator
   * template was used.
   */
  selectedEvaluatorPromptCode?: string;
};
