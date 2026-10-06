# ally-be documentation

| Doc | Description |
|-----|-------------|
| [prompts-folder.md](./prompts-folder.md) | Prompt folder (`src/prompts/`): naming, structure, optional `.meta.json`, adding new prompts |
| [prompts-api.md](./prompts-api.md) | Prompts API: exposing prompts to the dashboard, sync endpoint, auth, runtime resolution |
| [bug-hunter-memory-adr.md](./bug-hunter-memory-adr.md) | **Proposed ADR (OPP-0739).** Where Bug Hunter's memory lives: in-house Postgres + Weaviate via ally-ai, generalising Builder's lessons and curator; Mem0, Letta, Zep/Graphiti, LangMem and Cognee evaluated and why each was not adopted |
| [bug-hunter-prompt-audit.md](./bug-hunter-prompt-audit.md) | **Prompt standard + audit (OPP-0728, OPP-0709).** The eight-part structure every Bug Hunter prompt is held to, the seven prompts inventoried against it, what the 2026-09 audit found and changed (engine-blind escalation, unfenced untrusted input, contradictory phase order), and how to re-run it |
| [course-discussions.md](./course-discussions.md) | Inline learner discussions on course items: tenant isolation, moderator powers, delete/lock/edit-window rules, the API and the reply notification |
| [courses-certification-plan.md](./courses-certification-plan.md) | **Plan, not yet built.** Turning Ally into a courses + certification product: gaps in Track 2.0, the credential layer, 5 phases / ~13 PRs across ally-be, ally-web and ally-mobile |
| [effectiveness-analytics-plan.md](./effectiveness-analytics-plan.md) | **Plan + build record.** Measuring whether Ally improves the 14 helping skills: the theory-of-change chain, the finding that Skill growth read the AI actor's score (fixed), and ~40 chart specs across the Effectiveness, Helping skills, Usage, Curriculum, Course impact, Quality & sentiment and Orgs sub-tabs (AAQ-202..232). §13 records what was built, the decisions taken and where the build departed from the plan |
