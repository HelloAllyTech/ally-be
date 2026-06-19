/**
 * Parsing + scoring helpers for the Copilot orchestrator.
 */

/**
 * Shape of the agent-builder meta-prompt JSON (see
 * src/prompts/agent_builder_system_prompt.txt). Mirrors the keys the admin
 * frontend's `applyAgentBuilderOutputToForm` reads. All keys are optional —
 * the parser is tolerant and the orchestrator defaults anything missing.
 */
export interface CopilotBaseOutput {
  roleInstruction?: string;
  title?: string;
  description?: string;
  characterBackstory?: string;
  openingStatements?: string[];
  customFields?: Array<{ name?: string; value?: string }>;
  persona?: {
    name?: string;
    age?: number;
    gender?: string;
    genderIdentity?: string;
    sexualOrientation?: string;
    profession?: string;
    currentLocation?: string;
    context?: string;
  };
}

/**
 * Tolerant JSON parse of the agent-builder output: tries a direct parse, then
 * strips markdown fences, then rescues the outermost `{ ... }` object. Returns
 * null when nothing parseable is found. Ported from the admin frontend's
 * `parseAgentBuilderOutput` so server-side and client-side parsing agree.
 */
export function parseCopilotBaseOutput(
  raw: string | undefined | null,
): CopilotBaseOutput | null {
  if (!raw || typeof raw !== 'string' || !raw.trim()) return null;

  const attempt = (candidate: string): CopilotBaseOutput | null => {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as CopilotBaseOutput)
        : null;
    } catch {
      return null;
    }
  };

  const direct = attempt(raw.trim());
  if (direct) return direct;

  const defenced = raw
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const fromFenced = attempt(defenced);
  if (fromFenced) return fromFenced;

  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return attempt(raw.slice(first, last + 1));
  }
  return null;
}

/**
 * Composite 0-100 score for a report: the rounded mean of the per-metric
 * LLM-judge scores. Matches the admin frontend's `metricsAverage`
 * (ReportContent.tsx) so the score shown live equals the gate the loop uses.
 * Returns null when there are no metrics to average.
 */
export function computeCompositeScore(
  metrics: Record<string, number> | undefined | null,
): number | null {
  if (!metrics) return null;
  const values = Object.values(metrics).filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  if (values.length === 0) return null;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.round(mean);
}
