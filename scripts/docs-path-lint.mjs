#!/usr/bin/env node
// docs-path-lint — fail when a markdown doc names a file that does not exist.
//
// Why this exists: docs here point at code by path (`src/foo/bar.service.ts`), and code
// moves faster than docs. A reference to a file that was renamed or deleted still *looks*
// authoritative, so readers (and agents that follow the pointer) trust it and get nowhere.
// No test fails when that happens, so it was only ever found by someone getting lost.
//
// This file is identical in every Ally repo (ally-be, ally-web, ally-ai, ally-ai-learn,
// ally-mobile, the wiki). It has no dependencies on purpose — it runs with a bare `node`.
//
//   node scripts/docs-path-lint.mjs            # human output, exit 1 if anything is broken
//   node scripts/docs-path-lint.mjs --json     # machine output, same exit code
//   node scripts/docs-path-lint.mjs --siblings <dir>
//                                              # where to find sibling repo checkouts
//                                              # (default: the parent of this repo)
//
// What it checks: backticked paths in tracked markdown that look like `dir/file.ext`
// (ext = ts tsx js mjs cjs py md json yml yaml sh txt, optionally followed by `:line`).
// A path counts as present if a tracked file equals it or ends with `/` + it — docs write
// paths relative to a package or app as often as to the repo root, and a suffix match
// keeps those from being false alarms. Paths with a wildcard or placeholder (`*`, `<`,
// `[`, `{`, `...`), URLs, and anything inside a fenced code block are not references, so
// they are ignored. Paths git ignores (build output, a `.wiki-tmp` clone) are ignored too:
// they are legitimately absent from a fresh checkout.
//
// Cross-repo references (`ally-be/src/...` from another repo's docs) are checked only when
// that sibling checkout exists next to this one — it does on a developer machine, not in
// CI — and are skipped otherwise, so CI can never go red over a repo it cannot see. A
// repo's own wiki page (`repos/ally-ai.md`) names files relative to that repo, so its
// unprefixed paths are looked up there too, under the same skip rule.
//
// Ways to say "this reference is deliberate":
//   <!-- docs-path-lint: planned -->   on the same line or the line directly above — for
//                                      a file a plan doc says will exist later
//   <!-- docs-path-lint: ignore -->    same placement — for an example or a removed file
//                                      a doc discusses on purpose
//   .docs-path-lint-ignore             one path per line, `#` comments — for a path that
//                                      recurs too often to mark each mention
//
// Not scanned: node_modules, CHANGELOG*, wiki/log.md (append-only history that is
// supposed to name files as they were), and any file that announces itself as generated
// ("Generated — do not edit" near the top, as WIKI-ROUTING.md does): its paths belong to
// the generator, which writes them relative to a different repo, and a hand edit would be
// overwritten on the next sync.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Every repo the wiki's scope names, so `infra/dev_env.sh` in a doc is read as a path into
// the infra repo rather than a directory that happens to be called infra.
const SIBLING_REPOS = [
  "ally-be",
  "ally-web",
  "ally-ai",
  "ally-ai-learn",
  "ally-mobile",
  "helloallytech.github.io",
  "infra",
  "ally-changelog",
  "calibrate",
  "calibrate-backend",
  "calibrate-frontend",
];
const EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "mjs",
  "cjs",
  "py",
  "md",
  "json",
  "yml",
  "yaml",
  "sh",
  "txt",
];
const EXTENSION_RE = new RegExp(`\\.(?:${EXTENSIONS.join("|")})$`);
// `dir/file.ext`, optionally `./`- or `../`-prefixed and `:line` / `:line-line` suffixed.
// Needs a slash: a bare `README.md` names a file but says nothing checkable about where.
const REFERENCE_RE =
  /^((?:\.\/|(?:\.\.\/)+)?)([A-Za-z0-9_@.][\w@.()-]*(?:\/[\w@.()-]+)+)(?::\d+(?:-\d+)?)?$/;
const GENERATED_RE = /generated[^\n]{0,20}do not edit/i;
const MARKER_RE = /<!--\s*docs-path-lint:\s*(?:planned|ignore)\s*-->/;
const IGNORE_FILE = ".docs-path-lint-ignore";
const NOT_A_PATH = ["*", "<", "[", "{", "..."];

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const siblingsFlag = args.indexOf("--siblings");

function git(cwd, gitArgs, input) {
  return execFileSync("git", gitArgs, {
    cwd,
    input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function trackedFiles(cwd, pathspec) {
  const out = git(cwd, pathspec ? ["ls-files", "-z", "--", pathspec] : ["ls-files", "-z"]);
  return out.split("\0").filter(Boolean);
}

// `suffix` holds every suffix of every path ("a/b/c.ts" -> "a/b/c.ts", "b/c.ts", "c.ts"),
// so "ends with `/` + it" is one Set lookup instead of a scan per reference. `exact` holds
// the paths themselves, for the one case where a suffix match would be too generous.
function buildIndex(files) {
  const exact = new Set(files);
  const suffix = new Set();
  for (const file of files) {
    const parts = file.split("/");
    for (let i = 0; i < parts.length; i += 1) suffix.add(parts.slice(i).join("/"));
  }
  return { exact, suffix };
}

const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();

// The repo's own name, so `ally-be/src/x.ts` written inside ally-be's docs is checked
// against ally-be itself rather than treated as a sibling that may not be there.
function ownRepoName() {
  try {
    const url = git(root, ["remote", "get-url", "origin"]).trim();
    const name = url
      .split(/[/:]/)
      .pop()
      .replace(/\.git$/, "");
    if (name) return name;
  } catch {
    // no origin remote — fall through to the directory name
  }
  return path.basename(root);
}
const ownName = ownRepoName();
const siblingsDir = siblingsFlag >= 0 ? path.resolve(args[siblingsFlag + 1]) : path.dirname(root);

const ownIndex = buildIndex(trackedFiles(root));
const siblingIndexes = new Map(); // repo -> index | null (null = not available here)

function siblingIndex(repo) {
  if (!siblingIndexes.has(repo)) {
    const dir = path.join(siblingsDir, repo);
    let index = null;
    if (existsSync(dir)) {
      try {
        index = buildIndex(trackedFiles(dir));
      } catch {
        index = null; // a directory that is not a git checkout is as good as absent
      }
    }
    siblingIndexes.set(repo, index);
  }
  return siblingIndexes.get(repo);
}

function loadIgnoreList() {
  const file = path.join(root, IGNORE_FILE);
  if (!existsSync(file)) return new Set();
  const entries = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map(line => line.replace(/(^|\s)#.*$/, "").trim())
    .filter(Boolean);
  return new Set(entries);
}
const ignoreList = loadIgnoreList();

function isDocScanned(file) {
  if (file.split("/").includes("node_modules")) return false;
  if (/^CHANGELOG/i.test(path.posix.basename(file))) return false;
  if (file === "wiki/log.md") return false;
  return true;
}

// Lines of a markdown file that are prose, with fenced code blocks blanked out: a fence
// holds commands and examples, where a backticked path is part of the sample, not a claim.
function proseLines(text) {
  let fence = null;
  return text.split(/\r?\n/).map(line => {
    const opener = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (opener && opener[1][0] === fence[0] && opener[1].length >= fence.length) fence = null;
      return null;
    }
    if (opener) {
      fence = opener[1];
      return null;
    }
    return line;
  });
}

// Returns null when the backticked text is not a checkable reference, otherwise the path
// to look up: normalised, with any `./` / `../` prefix and `:line` suffix removed.
function parseReference(text) {
  if (text.startsWith("http") || text.includes("://")) return null;
  if (NOT_A_PATH.some(token => text.includes(token))) return null;
  const match = REFERENCE_RE.exec(text);
  if (!match) return null;
  const normalised = path.posix.normalize(match[2]).replace(/^(\.\.\/)+/, "");
  if (!EXTENSION_RE.test(normalised)) return null;
  return normalised;
}

// The repo a doc is *about*, when it is that repo's page in the wiki (`repos/<name>.md`).
// Writing `ally-ai/` before every path on the page about ally-ai would be pure noise.
function homeRepo(file) {
  const match = /(?:^|\/)repos\/([^/]+)\.md$/.exec(file);
  return match && match[1] !== ownName ? match[1] : null;
}

// 'present' | 'missing' | 'skipped' (a sibling checkout that is not here).
function resolve(refPath, file) {
  const [first, ...rest] = refPath.split("/");
  if (SIBLING_REPOS.includes(first) && rest.length) {
    const remainder = rest.join("/");
    if (first === ownName) return lookup(ownIndex, remainder);
    const index = siblingIndex(first);
    if (!index) return "skipped";
    return lookup(index, remainder);
  }
  const home = homeRepo(file);
  if (home) {
    const homeIndex = siblingIndex(home);
    if (homeIndex && lookup(homeIndex, refPath) === "present") return "present";
    if (lookup(ownIndex, refPath) === "present") return "present";
    return homeIndex ? "missing" : "skipped";
  }
  return lookup(ownIndex, refPath);
}

// A remainder with no slash (`ally-be/README.md` -> `README.md`) must be a root file:
// matching any README in the tree would make the check meaningless.
function lookup(index, candidate) {
  const found = candidate.includes("/") ? index.suffix.has(candidate) : index.exact.has(candidate);
  return found ? "present" : "missing";
}

const broken = [];
let scanned = 0;
let skippedCrossRepo = 0;
let exempted = 0;

for (const file of trackedFiles(root, "*.md").filter(isDocScanned)) {
  let text;
  try {
    text = readFileSync(path.join(root, file), "utf8");
  } catch {
    continue; // listed but absent from the working tree (sparse checkout)
  }
  if (GENERATED_RE.test(text.split(/\r?\n/, 15).join("\n"))) continue;
  scanned += 1;
  const lines = proseLines(text);
  const rawLines = text.split(/\r?\n/);

  lines.forEach((line, i) => {
    if (line === null) return;
    const marked = MARKER_RE.test(rawLines[i]) || (i > 0 && MARKER_RE.test(rawLines[i - 1]));
    for (const match of line.matchAll(/`([^`\s]+)`/g)) {
      const refPath = parseReference(match[1]);
      if (!refPath) continue;
      const status = resolve(refPath, file);
      if (status === "present") continue;
      if (status === "skipped") {
        skippedCrossRepo += 1;
        continue;
      }
      if (marked || ignoreList.has(refPath) || ignoreList.has(match[1])) {
        exempted += 1;
        continue;
      }
      broken.push({ file, line: i + 1, path: match[1], resolved: refPath });
    }
  });
}

// Last filter: a path git ignores (`dist/…`, a cloned `.wiki-tmp/…`) is absent from a clean
// checkout by design. Done once, in batch, and only for the few that would otherwise fail.
function dropGitIgnored(entries) {
  const own = entries.filter(e => !SIBLING_REPOS.includes(e.resolved.split("/")[0]));
  if (!own.length) return entries;
  let ignoredOut = "";
  try {
    ignoredOut = git(root, ["check-ignore", "--stdin", "-z"], own.map(e => e.resolved).join("\0"));
  } catch (error) {
    ignoredOut = error.stdout || ""; // exit 1 means "none of them are ignored"
  }
  const ignored = new Set(ignoredOut.split("\0").filter(Boolean));
  return entries.filter(e => !ignored.has(e.resolved));
}

const findings = dropGitIgnored(broken);

if (asJson) {
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: findings.length === 0,
        docsScanned: scanned,
        skippedCrossRepo,
        exempted,
        broken: findings.map(({ file, line, path: p }) => ({ file, line, path: p })),
      },
      null,
      2,
    )}\n`,
  );
} else {
  for (const f of findings) process.stdout.write(`${f.file}:${f.line}: ${f.path}\n`);
  const files = new Set(findings.map(f => f.file)).size;
  const notes = [];
  if (skippedCrossRepo) notes.push(`${skippedCrossRepo} cross-repo skipped (no sibling checkout)`);
  if (exempted) notes.push(`${exempted} exempted`);
  const tail = notes.length ? ` (${notes.join(", ")})` : "";
  process.stdout.write(
    findings.length
      ? `\ndocs-path-lint: ${findings.length} broken reference(s) in ${files} file(s), ${scanned} docs scanned${tail}\n` +
          `Fix the path, or mark a deliberate one with <!-- docs-path-lint: planned --> / ignore.\n`
      : `docs-path-lint: ok — ${scanned} docs scanned${tail}\n`,
  );
}

process.exitCode = findings.length ? 1 : 0;
