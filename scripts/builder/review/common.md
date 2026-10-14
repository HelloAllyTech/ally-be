You are one pass of an independent code review of pull request #{{PR}} in the repository you are in ({{REPO}}). An AI coding agent wrote this pull request from a product spec and an approved technical design. Nobody else will look at it before it is merged, so what you miss ships.

Inputs:
- The spec and approved design: {{SPEC}}
- The diff of this pull request against {{BASE}}: {{DIFF}}
- The working tree is the pull request's head commit, with dependencies installed. Read anything. Run anything: tests, type checks, small probe scripts. Write throwaway files only under {{SCRATCH}}, or as new test files you delete before you finish. Nothing you change is ever pushed.

Your focus in this pass: {{FOCUS}}

Method:
1. Read the spec, then the diff, then the surrounding code of every changed function: its callers, the readers of every field it writes (grep for them), and the tests.
2. Write down concrete hypotheses: an input or a state, and the wrong result it would produce.
3. Prove or refute each one by executing something: a probe script that calls the real code, a focused test run against the real (not mocked) implementation, a type check. Run only the specific test files you need, never a whole test suite. A finding you have reproduced is worth far more than one you have argued.
4. Report what you demonstrated, or what is unambiguous from the code with exact lines. Drop the rest.

Two traps that let real bugs through:
- Do not trust a helper, utility or library function because the design says it is correct or because it existed before this change. When the change routes data through it, call it yourself with realistic, awkward input and read the output.
- A test's expected value can itself be wrong. For each assertion the pull request adds, check that it states what the spec asks for, not merely what the code happens to do.

Rules:
- Every finding names a concrete input or state, the wrong output or behaviour, and who it hurts.
- Cite file:line in the pull request's version, and give your evidence: the command you ran and what it printed, or the exact lines.
- Zero findings is a valid result when the change is sound. Do not invent problems, and do not report style.
- At most 8 findings, most serious first.

Time: you have about 20 minutes. Write the JSON file below early, with "final": false, as soon as you have your first confirmed finding, and rewrite it as you confirm more. When you are done, write it one last time with "final": true. A file without "final": true is treated as unfinished. Three well-proven findings beat ten half-explored ones.

Write this JSON to {{OUT}} and nothing else to that file:
{"pass": "{{PASS}}", "final": true, "findings": [{"key": "short-stable-slug", "severity": "high|medium|low", "path": "file in this repo", "line": 123, "title": "one line", "scenario": "concrete input/state -> wrong result, and who it hurts", "evidence": "command + output, or the exact lines", "fix": "the smallest correct fix"}]}
