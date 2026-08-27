import { BugFindingSeverity } from 'src/bug-hunter/enum/bug-finding.enum';

import { UxSignalDetector, UxSignalKind } from './enum/ux-signal.enum';

/**
 * One threshold-crossing observation from a detector.
 *
 * Deliberately narrow. A signal carries counts, a coordinate and a handful of
 * sample rows — never raw person data. PostHog holds identified persons with
 * email and name attached (the frontends call `identify` with them), so a
 * detector that selected person properties would drag PII into an LLM prompt, a
 * findings table and an admin UI in one step. Detectors select event properties
 * and aggregates only; see `examples`.
 */
export interface UxSignal {
  detector: UxSignalDetector;
  /** The detector's prior. Triage may reclassify it with context. */
  defaultKind: UxSignalKind;
  /**
   * The stable coordinate this signal is about — a route path, normally.
   * Becomes the finding's `symbol`, which is what makes UX findings dedupe
   * precisely rather than through the description fingerprint.
   */
  route: string;
  /** The thing within the route: an endpoint, an element, a funnel name. */
  target?: string;
  metric: {
    name: string;
    value: number;
    /** The comparison the threshold was applied against, where one exists. */
    baseline?: number;
    threshold: number;
  };
  window: { from: string; to: string };
  /** Distinct sessions affected — the breadth half of every threshold. */
  sessions: number;
  users: number;
  /**
   * Compact sample rows for the prompt and the finding's evidence. Event
   * properties only, scrubbed of anything person-shaped (see scrubExample).
   */
  examples: string[];
}

/** One triage item exactly as the model returns it — nothing here is trusted yet. */
export interface RawTriageItem {
  kind?: unknown;
  title?: unknown;
  body?: unknown;
  severity?: unknown;
  rationale?: unknown;
  evidence?: unknown;
  route?: unknown;
  target?: unknown;
  suggestedGoal?: unknown;
  confidence?: unknown;
}

/** A triage item after validation, ready to be filed. */
export interface TriagedItem {
  kind: UxSignalKind;
  title: string;
  body: string;
  severity: BugFindingSeverity;
  rationale: string;
  evidence: string[];
  route: string;
  target?: string;
  /** Validated against the live goal taxonomy; null when the model's answer was not. */
  suggestedGoal: string | null;
  /** The model's own confidence, surfaced in the item rather than used as a gate. */
  confidence?: string;
}

/** What one scan did, as reported back to the caller and stored on the scan row. */
export interface UxScanOutcome {
  scanId: string;
  signalsDetected: number;
  findingsCreated: number;
  suggestionsCreated: number;
  skippedDuplicates: number;
  /** Detectors whose query failed, by name — never a silent absence. */
  failedDetectors: string[];
}
