# ally-be — Documentation lives in the Ally Developer Wiki

The canonical documentation for the Ally platform is maintained centrally in the
**Ally Developer Wiki**. Read it before starting work, and update it whenever you
change architecture, workflows, environment setup, or SDLC rules.

- 🌐 Browse: https://tech.helloally.ai
- 📁 Source: the `helloallytech.github.io` repo, `wiki/` folder (`wiki/repos/ally-be.md` for this service)

## Before you write an implementation plan

**Call the stacks MCP's `search_chunks` tool with 2–3 queries covering the task's main topics, and
incorporate relevant returned guidance, citing chunk titles.**

The `stacks` server is declared in this repo's committed `.mcp.json`; it reads your
`STACKS_API_KEY` from the environment, so no key is ever committed. Setup, query technique and the
citation format: https://tech.helloally.ai/#/wiki/contributing/planning-with-stacks.md

Trivial mechanical changes (rename, dependency bump, typo) are exempt.

Stacks **replaced** the wiki's `Product Management Best Practices` section, which was deprecated
on 2026-08-07 and is kept for history only — nothing in it is a gate, and where it conflicts with
Stacks, Stacks wins. It still records Ally-specific traps a general corpus won't have, so it is
worth checking when a query comes back empty on something Ally-specific.

## Key pages
- This repo — https://tech.helloally.ai/#/wiki/repos/ally-be.md
- Platform overview — https://tech.helloally.ai/#/wiki/platform/overview.md
- Architecture & data flow — https://tech.helloally.ai/#/wiki/platform/architecture.md
- Cross-repo agent guide (conventions, common tasks, gotchas) — https://tech.helloally.ai/#/wiki/platform/agent-guide.md
- *(Deprecated 2026-08-07)* Product Management Best Practices — https://tech.helloally.ai/#/wiki/product/best-practices.md — replaced by Stacks; kept for history, no longer a gate.
- Contributing / SDLC rules — https://tech.helloally.ai/#/wiki/contributing/guide.md
- **Planning with the Stacks MCP** (search before every implementation plan) — https://tech.helloally.ai/#/wiki/contributing/planning-with-stacks.md
- Developer setup — https://tech.helloally.ai/#/wiki/contributing/dev-setup.md

> ⚠️ The wiki is **public**. Never add secrets, credentials, IP addresses, internal
> hostnames/domains, or cloud region details to it.
