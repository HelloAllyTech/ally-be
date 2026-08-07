# Contributing to ally-be

The contributing rules for **every** Ally repo are maintained in one place:

### 👉 [Contributing Guide — tech.helloally.ai](https://tech.helloally.ai/#/wiki/contributing/guide.md)

Branch naming, conventional commits, code standards, the PR process, and review
expectations all live there. They used to be copied into each repo, the copies drifted,
and the branch-naming rule ended up contradicting itself across three files — so there is
now exactly one canonical statement of each rule.

| Looking for | Go to |
|---|---|
| Branch, commit and PR conventions | [Contributing Guide](https://tech.helloally.ai/#/wiki/contributing/guide.md) |
| Local setup | [Developer Setup](https://tech.helloally.ai/#/wiki/contributing/dev-setup.md) · [README](README.md) |
| Releasing | [Release Process](https://tech.helloally.ai/#/wiki/contributing/release-process.md) · [`.github/RELEASE_GUIDE.md`](.github/RELEASE_GUIDE.md) |
| Where to start on a task | [`AGENTS.md`](AGENTS.md) — the router for this repo |
| Why docs CI failed on your PR | [Documentation System](https://tech.helloally.ai/#/wiki/contributing/docs-system.md) · [`.docs-map.yml`](.docs-map.yml) |

## One repo-specific rule

Your PR must keep documentation in step with your code. [`.docs-map.yml`](.docs-map.yml)
declares which docs cover which paths and CI enforces it. If a doc genuinely doesn't need
to move, apply the `docs:skip` label — with a reason in the PR description.
