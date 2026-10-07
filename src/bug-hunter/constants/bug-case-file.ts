import { BugFindingSource, BugFindingSeverity } from '../enum/bug-finding.enum';
import { BugCaseBudget } from '../type/bug-case-budget.type';
import { BugFindingMiss } from '../type/bug-finding-miss.type';
import { FixDossierSession } from './bug-fix-dossier';
import { BugHuntDecision } from '../entity/bug-hunt-decision.entity';

/**
 * The case file: everything Bug Hunter knows about one bug, as typed records
 * — OPP-0775.
 *
 * The fix dossier (`FixDossier`) was the first version of this idea, built
 * for one reader: the session about to fix the bug. The case file is the
 * same facts for every reader — the dossier, the drawer, the Verifier
 * (OPP-0779/0780), the orchestrator (OPP-0783) and the replay harness — so a
 * stage reads the one field it needs instead of parsing prose, and nothing
 * is assembled twice. `BugHunterDossierService` now takes its sessions,
 * verdicts, lineage and post-mortem from here and adds only what a fix
 * session alone wants (similar fixes, open neighbours, notebook hits).
 *
 * Verdicts and attempts are derived from the finding's own rows and
 * timeline, not stored separately: `bug_hunt_events` is already the
 * append-only record, and the protocols already post structured payloads
 * for `fix_attempt` and the Verify phase. The case file gives those payloads
 * one typed shape and one place to read them.
 */
export interface BugCaseFile {
  finding: {
    id: string;
    repo: string | null;
    title: string;
    description: string;
    originalDescription: string | null;
    file: string | null;
    symbol: string | null;
    source: BugFindingSource;
    severity: BugFindingSeverity | null;
    proven: boolean;
    evidence: string | null;
    touchesGuardedPath: boolean;
    status: string;
    prUrl: string | null;
    createdAt: Date;
  };
  /** Who filed it and what their client captured — human-reported bugs only. */
  reporter: {
    source: 'staff' | 'consumer';
    name: string | null;
    reportedAt: Date;
    context: Record<string, unknown> | null;
  } | null;
  /** Why Bug Hunter did not find a reported bug first (OPP-0774). */
  miss: BugFindingMiss | null;
  /** Every independent judgement on this bug or its fixes, oldest first. */
  verdicts: BugCaseVerdict[];
  /** Fix sessions on this bug, newest first, with their structured attempts. */
  sessions: FixDossierSession[];
  /** The post-mortem the last failed session left behind (OPP-0735). */
  postmortem: Record<string, unknown> | null;
  lineage: {
    regressionOf: string | null;
    regressed: boolean;
    rediscoveredCount: number;
  };
  budget: BugCaseBudget;
  /**
   * Orchestration decisions on this case (OPP-0776). Empty until the decision
   * log exists; reserved here so readers written now do not change shape.
   */
  decisions: BugHuntDecision[];
  /** Totals a reader wants without walking the arrays. */
  totals: {
    sessions: number;
    attempts: number;
    verdicts: number;
  };
}

/**
 * One independent judgement. Today these come from the sweep's Verify phase
 * (two verifiers on a finding, kind `finding`) and from the Verify phase
 * refuting one (a `decision_recorded` by verification). The Verifier stage
 * (OPP-0779) adds kind `fix` with named checks.
 */
export interface BugCaseVerdict {
  kind: 'finding' | 'fix';
  verdict: 'confirmed' | 'refuted' | 'unsure' | 'pass' | 'fail' | 'unavailable';
  /** 0–1 where a verifier gave one. */
  confidence: number | null;
  reason: string | null;
  /** Named checks with evidence — the Verifier stage fills these; the sweep's verifiers leave it empty. */
  checks: { name: string; ok: boolean; evidence: string | null }[];
  /** Which engine, vendor or model judged, when known. */
  by: string | null;
  runId: string | null;
  at: Date | null;
}
