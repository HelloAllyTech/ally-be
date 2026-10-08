#!/usr/bin/env python3
"""Which of a change's config edits alter how the gate judges it.

run-test-gate.sh lists every touched file matching GATE_CONFIG_PATTERNS. Most
of those files exist only to configure a check (a jest or eslint config, a
tsconfig, conftest.py), so any edit counts. Three are shared with things a
build legitimately changes:

  package.json    dependencies; only `scripts` and the tool keys judge
  pyproject.toml  dependencies; only the [tool.<checker>] tables judge
  setup.cfg       metadata; only the checker sections judge

For those three, a file counts only when a judging section differs from
origin/master. Adding a dependency is not editing the gate. Changing what
`npm test` runs is.

Usage: gate-config-diff.py <repo dir> <comma-separated touched files>
Prints the files that count, comma-separated. Anything it cannot read counts:
a parse failure is no reason to wave an edit through.
"""

import configparser
import json
import subprocess
import sys

PACKAGE_KEYS = ("scripts", "jest", "eslintConfig", "prettier", "vitest", "nx", "ava", "mocha")
PYPROJECT_TOOLS = (
    "pytest", "ruff", "mypy", "black", "isort", "flake8", "pylint", "coverage", "pyright",
)
SETUP_CFG_SECTIONS = ("tool:pytest", "flake8", "pycodestyle", "isort", "coverage:")


def original(directory, path):
    """The file at origin/master, or None when it did not exist there."""
    try:
        return subprocess.run(
            ["git", "-C", directory, "show", f"origin/master:{path}"],
            check=True, capture_output=True, text=True,
        ).stdout
    except subprocess.CalledProcessError:
        return None


def current(directory, path):
    try:
        with open(f"{directory}/{path}", encoding="utf-8") as handle:
            return handle.read()
    except OSError:
        return None


def package_view(text):
    data = json.loads(text)
    return {key: data.get(key) for key in PACKAGE_KEYS}


def pyproject_view(text):
    import tomllib

    tool = tomllib.loads(text).get("tool", {})
    return {name: tool.get(name) for name in PYPROJECT_TOOLS}


def setup_cfg_view(text):
    parser = configparser.ConfigParser(interpolation=None)
    parser.read_string(text)
    return {
        section: dict(parser[section])
        for section in parser.sections()
        if section.startswith(SETUP_CFG_SECTIONS) or section.startswith("mypy")
    }


VIEWS = {
    "package.json": package_view,
    "pyproject.toml": pyproject_view,
    "setup.cfg": setup_cfg_view,
}


def judges(directory, path):
    view = VIEWS.get(path.rsplit("/", 1)[-1])
    if view is None:
        return True
    before, after = original(directory, path), current(directory, path)
    if before is None or after is None:
        # Added or deleted outright. A new package.json can carry its own test
        # script; a deleted one takes its package's script with it.
        return True
    try:
        return view(before) != view(after)
    except Exception:  # noqa: BLE001 — unreadable means unvouched-for
        return True


def main():
    directory = sys.argv[1]
    touched = [path for path in (sys.argv[2] if len(sys.argv) > 2 else "").split(",") if path]
    print(",".join(path for path in touched if judges(directory, path)))


if __name__ == "__main__":
    main()
