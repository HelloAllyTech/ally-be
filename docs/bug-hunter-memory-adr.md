# ADR: Where Bug Hunter's memory lives, and how it is searched

Status: **Proposed, prototype built** (spike for roadmap item OPP-0739, 23 September 2026).
Decision owner: Shubham Bhoite. Supersedes nothing; the memory items
OPP-0714 (lessons notebook), OPP-0740 (memory as a tool), OPP-0715
(exemplar bank) and OPP-0737 (retrieval-augmented verification) build on it.

## Context

Bug Hunter is to keep a notebook the way an engineer would: short entries
(under 600 characters) on where bugs hide at Ally, how a hard class of bug was
eventually solved, and what turned out not to be a bug. The agent writes to it
at reflection points in every run and searches it by meaning mid-task, humans
can add, edit and retire entries, kinds of memory emerge through open tags, and
it lives in a private store rather than the open repo. The product lead asked
that we look at what already exists before building, because someone has
usually done the abstraction work.

Constraints that shape the choice:

- **Stack.** ally-be is NestJS + TypeORM on Postgres. The agent runs as
  Claude Code on a CI runner and reaches ally-be over HTTP (soon MCP,
  OPP-0708). Anything Python-only becomes a second service to deploy and
  authenticate.
- **What already exists here.** `builder_lessons` with an ExpeL-style curator
  (AGREE/EDIT/ADD/REMOVE, source counts, applied/contradicted counters,
  pinning, a capped active set) and `builder_exemplars` — the storage and
  curation half of the notebook, built and running. `RoadmapVectorService`
  keeps Postgres as the system of record and a Weaviate collection (via
  ally-ai's `AiService`) as a derived, hash-reconciled semantic index — the
  search half, built and running for roadmap items. Postgres deliberately has
  no pgvector today (see migration 1871000000000's note).
- **Shape of the data.** Hundreds to low thousands of curated, human-readable
  entries written deliberately at reflection points. Not a stream of chat
  turns to mine facts from, and not a world model of entities and relations.
- **Cost discipline.** Retrieval is a handful of entries per lookup, every
  lookup is recorded (OPP-0741), and the context spent on memory per run must
  stay flat as the notebook grows.

## Options considered

| | Language / SDK | Storage | Curation model | Self-host | Fit with the notebook shape | Verdict |
|---|---|---|---|---|---|---|
| **Mem0 OSS** | Python + TypeScript SDK (`mem0ai` on npm); Apache-2.0; 37k stars | 20 vector backends incl. pgvector and Weaviate; optional Neo4j for graph | LLM extracts facts from conversation and decides ADD/UPDATE/DELETE per fact | Yes (Docker: API + Postgres/pgvector + Neo4j) | Built for user personalisation from dialogue. Our entries are written deliberately by the agent, not extracted from turns; its extraction step is the part we do not want. The TS SDK is real but the OSS server is Python. | Patterns worth copying; runtime not adopted |
| **Letta (MemGPT)** | Python server; Apache-2.0 | Postgres + pgvector | Agent-managed core/archival memory, sleep-time consolidation | Yes | An agent *runtime*. Bug Hunter's runtime is Claude Code; Letta would be a second one with its own loop, tools and model config. | Rejected: wrong layer |
| **Zep / Graphiti** | Graphiti: Python, Apache-2.0, ~24k stars; Zep Community Edition discontinued 2025; managed Zep is commercial | Neo4j / FalkorDB / Neptune / Kuzu | Temporal knowledge graph of entities and facts with validity windows | Graphiti yes, needs a graph DB | Strong for "how did this fact change over time"; our entries are lessons, not facts about entities. New infrastructure (graph DB) and Python. | Rejected for now |
| **LangMem / LangGraph store** | Python; MIT | LangGraph `AsyncPostgresStore` with pgvector | Extraction + consolidation prompts over a namespaced KV store | Yes | Python and LangGraph-shaped; ally-be is neither. The maintained JS piece is `PGVectorStore` in `@langchain/community`, which is a vector store, not a memory system. Quiet since late 2025. | Rejected |
| **Cognee** | Python core, TypeScript SDK, MCP server; Apache-2.0; ~12k stars | Can run entirely on one Postgres (pgvector) or graph + vector + Redis | ECL pipeline: extract, "cognify" into graph + vectors, load; hybrid graph/vector search | Yes | The MCP server plugs straight into Claude Code, which is attractive. But it is a knowledge-graph engine over documents; our need is curated short entries with human editing and a size cap, and it adds a Python service. | Revisit if we want graph-shaped memory (contract maps, module relations) |
| **In-house A: Postgres + Weaviate via ally-ai** | TypeScript, already here | Postgres source of truth; Weaviate collection as derived index (RoadmapVectorService pattern) | Builder curator generalised to an agent-scoped table | Already hosted | Exactly the shape: entries are rows, curated by the existing pass, embedded on write, reconciled by hash, searched by meaning through an endpoint we already call. No new service, no new language. | **Chosen** |
| **In-house B: Postgres + pgvector** | TypeScript | pgvector column on the same table | Same curator | Needs the extension enabled in prod Postgres, plus an embedding call from ally-be | Simplest topology, but the platform's stated position (migration 1871000000000) is that Postgres does not hold vectors and Weaviate does. Two vector stores is a new rule. | Fallback if Weaviate proves a bottleneck |

Scores were qualitative rather than a weighted sum: every hosted-runtime
option lost on the same two facts (Python service, second agent loop or
extraction pipeline we do not need), and the in-house options won on the same
two (the stack, and the two halves of the notebook already existing).

## Decision

Build Bug Hunter's memory in-house on **Postgres as the system of record and
Weaviate (via ally-ai) as the semantic index**, generalising the Builder
lesson tables and curator rather than adding a second set, and borrowing
Mem0's operation model for writes.

Concretely:

1. **One table for agent memory**, `agent_memories`, migrated from
   `builder_lessons` with an `agent` scope column (`builder`, `bug_hunter`)
   and the columns the lead asked for: `text` (≤ 600 chars, enforced by CHECK),
   open `tags` (jsonb), `repos`, `kind` as a free tag rather than a fixed enum,
   `status` (candidate / active / merged / retired), `pinned`, `sourceCount`,
   `timesApplied`, `timesContradicted`, `mergedIntoId`, provenance (`runId`,
   `findingId`, `createdBy` for human entries), `textHash` and
   `embeddingStatus` (the RoadmapVectorService reconciliation fields).
   Builder's existing rows migrate with `agent = 'builder'`; its curator and
   `BuilderKnowledgeService` read the same table filtered by agent.
2. **Embedding on write, reconciled by hash**, through a new ally-ai
   collection `AgentMemory` and the same upsert / find-similar / list-ids /
   delete surface `RoadmapVectorService` already uses. Vectors stay derived:
   a failed embed is `PENDING`/`FAILED` on the row and a reindex heals it.
3. **Write operations, not appends.** A reflection produces candidate bullets;
   the curator (Builder's, generalised) decides AGREE / EDIT / ADD / REMOVE
   against the active set — the same four operations Mem0 applies per fact,
   here applied to lessons. Human edits are direct row updates; pinned rows
   are never touched by the curator.
4. **Two access paths** (OPP-0740): a small always-on set rendered into the
   prompt (top-scored active entries for the repo, capped like
   `BUILDER_LESSONS_IN_CONTEXT`), and `search_memory` / `write_memory` tools
   the agent calls mid-task, served by ally-be over MCP with a retrieval cap
   and relevance threshold in settings. Every search is recorded as a
   `memory` context lookup (OPP-0741) with relevance and used count.
5. **Private by default.** The table lives in ally-be's Postgres; nothing is
   committed to a repo. An admin view lists, edits and retires entries.

## Why not adopt Mem0 outright

It was the closest external fit and deserves a plain answer. Mem0's value is
turning conversation into facts and keeping them consistent; its TypeScript
SDK is a client to that pipeline. Bug Hunter's entries are already facts,
written on purpose, one at a time. Adopting Mem0 would mean running its Python
server (or the hosted platform, which fails the private-store constraint),
routing deliberate notes through an extraction step designed for chat, and
duplicating curation that Builder already has in TypeScript. What Mem0 gets
right — one decision per write among ADD/UPDATE/DELETE/NOOP, scoped memories,
metadata for filtering, the search-with-filters shape — is a design we copy,
not a dependency we take.

## What would change this decision

- **Graph-shaped questions.** If the roadmap's cross-repo contract finder
  (OPP-0721) or the knowledge pack (OPP-0716) turn out to need "what depends
  on what" reasoning rather than "what did we learn", Cognee's MCP server on a
  single Postgres is the first thing to re-evaluate.
- **Weaviate as a bottleneck.** If lookup latency or ally-ai coupling becomes
  the cost, In-house B (pgvector) is a one-migration change to the same table.
- **Mem0 shipping a TypeScript server.** That would remove the Python-service
  objection; the extraction-shape objection would remain.

## Prototype

Built in the same branch as this decision, scoped to prove the shape end to end:

- **ally-be**: `agent_memories` table (migration `1972000000000`) with the
  `agent` scope, the 600-character CHECK, open `tags`, Builder's curation
  columns and the roadmap's reconciliation fields; `src/agent-memory/` module
  with write, search, list, retire and reindex; `AiService` client methods for
  the new collection; Bug Hunter endpoints `GET pipeline/memory/search` (recorded
  as a `memory` context lookup with its top relevance) and `POST pipeline/memory`
  for the agent, `GET/POST v1/bug-hunter/memory` and `POST memory/:id/retire`
  for admins. The sweep prompt reads the notebook in a new Phase 0 and writes up
  to three entries in a new Phase 5; the fix prompt asks before reproducing and
  offers one entry before closing.
- **ally-ai**: `AgentMemory` Weaviate collection (migration 007, vectors and
  metadata only, `agent` a required filter), `AgentMemoryService` mirroring the
  roadmap service, `/api/v1/agent-memories` upsert, search, delete and ids
  endpoints, every search reported to the retrieval log.

Also built, at the product owner's request that none of this touch Builder's
code: the notebook's own curator (`AgentMemoryCuratorService`, scoped by the
`agent` column, hourly, with the same AGREE/EDIT/ADD/REMOVE operations and the
same guardrails in code as Builder's), so the agent's entries land as
candidates and are folded into the active set within the hour; the always-on
subset of the strongest entries rendered into the sweep prompt; and a
15-minute reindex timer that heals vectors that failed to embed.

**A consequence to state plainly:** for now there are two curators, Builder's
over `builder_lessons` and this one over `agent_memories`. That is the
duplication the decision above set out to avoid, accepted because moving
Builder's rows is Builder's change to make. When it happens (OPP-0714) Builder's
curator is deleted and this one takes over; the tables and operations are
already the same shape so that is a data move, not a rewrite.

Not in the prototype: moving Builder's rows, an admin view, and counting which
entries a run said it applied (`timesApplied`), which needs the agent to report
ids back and is part of the memory-as-tool item.

Success criterion, to be checked once both services deploy: a hand-written
entry via `POST v1/bug-hunter/memory` comes back for a paraphrased query via
`GET pipeline/memory/search`, and the lookup appears in
`bug_hunt_context_lookups` with kind `memory` and a relevance score. Deploy
order is ally-ai first (the collection must exist before ally-be writes to it),
then ally-be.

## Sources

- Mem0 monorepo, AGENTS.md (packages, Apache-2.0):
  https://github.com/mem0ai/mem0/blob/main/AGENTS.md
- Mem0 self-hosting stack (API + Postgres/pgvector + Neo4j) and vector
  backends: https://mem0.ai/blog/self-host-mem0-docker,
  https://mem0.ai/blog/state-of-ai-agent-memory-2026
- Letta repository and licence: https://github.com/letta-ai/letta;
  comparison with Mem0: https://vectorize.io/articles/mem0-vs-letta
- Graphiti repository (Python, Apache-2.0, graph backends, MCP server):
  https://github.com/getzep/graphiti; Zep Community Edition status and
  architecture paper: https://arxiv.org/abs/2501.13956,
  https://vectorize.io/articles/mem0-vs-zep
- LangMem repository (Python, MIT, Postgres store):
  https://github.com/langchain-ai/langmem; pgvector store for LangChain.js:
  https://docs.langchain.com/oss/javascript/integrations/vectorstores/pgvector
- Cognee repository (Apache-2.0, Postgres-only mode, TypeScript SDK, MCP):
  https://github.com/topoteretes/cognee
- Framework comparisons and benchmarks (LoCoMo, LongMemEval):
  https://vectorize.io/articles/best-ai-agent-memory-systems,
  https://atlan.com/know/best-ai-agent-memory-frameworks-2026/
- In-repo precedents: `src/product-roadmap/service/roadmap-vector.service.ts`,
  `src/builder/service/builder-lesson-curator.service.ts`,
  `src/builder/entity/builder-lesson.entity.ts`, migration
  `1871000000000-CreateProductRoadmapTables.ts` (no pgvector note).
