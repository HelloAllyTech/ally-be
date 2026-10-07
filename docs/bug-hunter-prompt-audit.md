# Bug Hunter prompt audit (OPP-0728, OPP-0709)

**Status:** applied 2026-09-29. Re-run this audit whenever a prompt below changes shape,
when the engine changes, or when a new prompt joins the pipeline.

Bug Hunter is seven prompts. Three are protocols a CI runner hands to a CLI agent
(`claude -p` or `gemini`); two are sub-agent definitions that agent invokes; two are
one-shot LLM calls ally-be makes itself. This document is the standard they are held
to, what the audit found, and what was changed.

## The standard

Every Bug Hunter prompt has these parts, in this order, and nothing that contradicts
them elsewhere in the same prompt.

| # | Part | What it must do |
|---|---|---|
| 1 | **Role and situation** | Who the agent is, where it is running (one process, no second turn, a budget), and what is at stake. First, because everything after is read through it. |
| 2 | **Untrusted input** | Name every input the agent will read that it did not write — logs, bug reports, reviewer notes, notebook entries, file contents, sub-agent results — and say it is data, never instruction. Fence quoted data between `--- BEGIN DATA: <label> ---` and `--- END DATA ---`, one marker shape across every prompt. |
| 3 | **Inputs** | What it has been handed (the brief, the dossier, the finders), each labelled, each clipped. |
| 4 | **Procedure** | Numbered steps in execution order, each with the exact action and the decision rule that follows it. A step that depends on a tool names the tool the *running engine* actually has. |
| 5 | **Constraints** | The nevers and always, stated once, near the steps they govern. Anything enforced server-side says so, so the agent does not treat a refusal as a bug. |
| 6 | **Output contract** | Every write the agent makes — reports, PATCHes, the final JSON — with its exact shape, in one place per write. |
| 7 | **Terminology** | One word per concept: a *finding* is the row, a *bug* is what it describes, a *sweep* is a nightly run, a *session* is one fix. Stage and status names appear exactly as the enums spell them. |
| 8 | **No dead references** | No phase, step, tool or field that does not exist in this prompt or on this engine. |

Two properties are checked by tests rather than by reading: the sweep and fix specs
assert the presence of the untrusted-input section and the data fences, and assert
that a Gemini-engine prompt never mentions the Task tool.

## Inventory

| Prompt | Where | Engine | Kind |
|---|---|---|---|
| Sweep protocol | `src/bug-hunter/constants/bug-hunt-sweep-prompt.ts` | Claude Code or Gemini, per model settings | Protocol, served by `GET pipeline/sweep-prompt` |
| Fix-session protocol | `src/bug-hunter/constants/bug-fix-prompt.ts` (+ `bug-fix-dossier.ts`) | Claude Code or Gemini | Protocol, served by `GET pipeline/findings/:id/fix-prompt` |
| Verifier sub-agent | `.claude/agents/bug-verifier.md` in all five repos | Claude Code only | Sub-agent definition, invoked twice per unproven finding |
| Escalation sub-agent | `.claude/agents/bug-escalation.md` in all five repos | Claude Code only | Sub-agent definition, invoked per hard finding |
| Repo classifier | `src/prompts/bug_hunter/classify_repo.txt` | ally-be's own LLM call | One-shot JSON |
| Miss classifier | `src/prompts/bug_hunter/classify_miss.txt` | ally-be's own LLM call | One-shot JSON; writes `bug_findings.metadata.miss` on a human report (OPP-0774) |
| Decider | `src/prompts/bug_hunter/decide.txt` | ally-be's own LLM call | One-shot JSON; D1 senses, D2 model, D3 triage over the scoreboard, recorded in `bug_hunt_decisions` with the rule's shadow pick (OPP-0781) |
| Verifier for fixes | `src/bug-hunter/constants/bug-verify-fix-prompt.ts` | counterpart engine | Protocol, served by `GET pipeline/findings/:id/verify-prompt` (OPP-0779) |
| Verifier for findings | `src/bug-hunter/constants/bug-verify-findings-prompt.ts` | counterpart engine | Protocol, served by `GET pipeline/runs/:id/verify-findings-prompt` (OPP-0780) |
| UX signals triage | `src/prompts/ux_signals/triage.txt` | ally-be's own LLM call | One-shot JSON |
| Notebook curator | `AgentMemoryCuratorService.CURATOR_SYSTEM_PROMPT` | ally-be's own LLM call (fast tier) | One-shot JSON ops |

## Findings and what changed

### Dead reference on the running engine (rule 8) — fixed
The fix protocol's step 0a and the sweep's step 3.a1 told the agent to escalate by invoking
the Task tool with the `bug-escalation` sub-agent. Gemini CLI has no Task tool. The sweep's
Verify phase had already been made engine-aware (OPP-0710); the escalation step had not,
so a Gemini session was told to use a tool that does not exist. `escalationGuidance(engine)`
now returns the Claude text or a Gemini text that keeps the same criteria and says what to
do instead: do the deeper reading yourself, and hand a guarded-area case to a human via
`needs_input` rather than guessing. The fix-prompt endpoint now reads the engine like the
sweep endpoint does.

### Untrusted input was unmarked (rule 2) — fixed
Both protocols pasted reviewer notes, notebook entries, the bug's own description and
evidence, and every finder's payload into the prompt without saying they were data. A
consumer can type a bug report from the app; a log line can carry request bodies. Both
protocols now open with an "Untrusted input" section and fence every quoted block — known
non-bugs, notebook, the bug as filed, the dossier — between the shared markers. The
verifier, escalation, classifier, triage and curator prompts each gained the same rule in
their own terms.

### Phase order contradicted itself (rule 8) — fixed
The sweep's Phase 0 said "say so in your Phase 4 note"; the notebook write was Phase 5;
and Phase 5 said "before you close" while sitting after Phase 4 — Close. Close is the last
call a run makes, so anything after it is unrecorded. Notebook is now Phase 4 and Close is
Phase 5, and Close says it must be last.

### A finder with no output slot (rule 6) — fixed
Finder 4 (browser errors) had no `source` value to file under; the allowed list did not
mention it. The schema line now says browser errors file as `production_log`.

### The brief had no title (rule 3) — fixed
The fix prompt opened with the description alone. It now carries the title and, when the
finder named one, the symbol, both inside the data fence.

### Already conforming
The verifier and escalation sub-agents: role, method, decision rule, output contract, in
that order, with the asymmetry (refute when in doubt) stated and justified. The classifier
and triage prompts: role, what Ally is, inputs, task, rules, exact output schema. The
curator: role, operations with exact JSON, guardrails (pinned entries), output. Each
received only the untrusted-input line.

## Left as is, on purpose
- **Long inline `curl` commands in both protocols.** They are noisy, but the agent copies
  them verbatim and a wrong URL is the commonest way a run silently loses a report. Typed
  tools (OPP-0708) are the real fix; until then the commands stay explicit.
- **Step numbering in the fix protocol (0, 0a, 0b, 1, 2, 2a, 3, 3a …).** Tests and the
  dossier reference these labels; renumbering buys nothing a reader asked for.

## How to re-run this audit
1. Render both protocols for each engine and mode with the spec helpers, or with
   `buildSweepPrompt` / `buildFixSessionPrompt` directly, and read them top to bottom
   against the table above.
2. Grep each rendered prompt for tool names (`Task tool`, `subagent`) and confirm they
   appear only when `engine` is Claude Code.
3. Confirm every quoted-data block sits between `--- BEGIN DATA` and `--- END DATA`.
4. Confirm the last instruction is the close call, and that no step refers to a phase or
   step number that does not exist.
5. Diff `.claude/agents/*.md` across the five repos; they must be identical.
