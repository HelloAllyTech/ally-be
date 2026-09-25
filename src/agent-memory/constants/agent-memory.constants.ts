/**
 * Knobs for the agent notebook — see `AgentMemoryService`,
 * `AgentMemoryCuratorService` and docs/bug-hunter-memory-adr.md.
 *
 * Deliberately the same shape and, where the reasoning carries over, the
 * same values as Builder's lesson constants: the two notebooks are meant to
 * converge on one table and one curator (OPP-0714), and numbers that differ
 * for no reason are the kind of drift that makes that harder later.
 */

/** Entries rendered into a prompt up front, strongest evidence first, per agent and repo. */
export const AGENT_MEMORY_IN_CONTEXT = 12;

/**
 * Hard cap on the ACTIVE set per agent. The prompt budget for memory is fixed,
 * so an unbounded set does not mean more memory — it means the newest entries
 * crowd out everything learned before them. The curator retires the weakest
 * to stay inside it; pinned rows are never candidates.
 */
export const AGENT_MEMORY_ACTIVE_CAP = 80;

/** Candidates needed before a scheduled pass spends a model call; the timer catches the rest. */
export const AGENT_MEMORY_CANDIDATE_TRIGGER = 5;

/** Curator mutex, so an hourly job on N pods is still one pass. */
export const AGENT_MEMORY_CURATE_LOCK = 'agent-memory-curate';
/** Slightly over the cadence, so a pod that dies mid-pass cannot hold it forever. */
export const AGENT_MEMORY_CURATE_LOCK_TTL_SECONDS = 70 * 60;

export const AGENT_MEMORY_CURATE_INTERVAL = 'hourly';
export const AGENT_MEMORY_CURATE_TASK = 'agent-memory-curate';

/** Re-push vectors that failed to embed. Cheap: one indexed query when nothing is pending. */
export const AGENT_MEMORY_REINDEX_INTERVAL = '15min';
export const AGENT_MEMORY_REINDEX_TASK = 'agent-memory-reindex';

/** AI-task-registry id for the curator's one model call — see ai-task-registry.constants.ts. */
export const AGENT_MEMORY_CURATION_AI_TASK_ID = 'agent-memory-curation';

/** Output budget for the curator: a JSON array of operations, never prose. */
export const AGENT_MEMORY_CURATOR_MAX_TOKENS = 4096;
