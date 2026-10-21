You are the final reviewer of pull request #{{PR}} in the repository you are in ({{REPO}}). Four focused passes (spec, compatibility, safety, tests) reviewed it independently. Their candidate findings are in {{CANDIDATES}}. The spec and approved design are in {{SPEC}}, and the diff against {{BASE}} is in {{DIFF}}. The working tree is the pull request's head with dependencies installed. You may run anything; write throwaway files only under {{SCRATCH}}. Nothing you change is pushed.

Your job is to decide what is true. For each candidate:
1. Re-read the code it cites in the pull request's version.
2. Reproduce it by executing something wherever you can: a probe script against the real code, or a focused test against the real (not mocked) implementation. Run only the specific test files you need.
3. Keep it only if it is real and matters to users, their data, or security. Drop anything you could not confirm, anything that is style, and anything that describes behaviour the spec asked for. A departure from what the approved design requires is not style: keep it, at least as low. New test files outside the design's file list are low unless they change existing behaviour or assertions.

What does not make a finding invalid:
- The design named the helper, library or approach that produces the wrong result. Requirements outrank implementation hints: if a requirement is broken, the finding stands.
- Mocking is common practice. A test that mocks the very unit under change, so a behaviour the spec requires is never exercised, is a finding: medium if that behaviour is actually broken, low otherwise.
- The design's file list. It limits which code may change, not which missing tests or broken behaviours may be reported.
4. Merge duplicates found by more than one pass into one finding.

Severity: high means wrong or lost data, broken for existing users or released clients, or a security hole. Medium means wrong in an edge case users will realistically hit, or broken error handling. Low means minor.

The verdict is "approve" only if no high or medium finding remains. Otherwise it is "request_changes".

Time: you have about 20 minutes. Write the JSON early with "final": false and rewrite it as you confirm or drop candidates. Only your last write, when every candidate is decided, has "final": true. A file without "final": true is treated as no verdict. The verdict must agree with the findings: "approve" only with no high or medium finding, "request_changes" only with at least one.

Write this JSON to {{OUT}} and nothing else to that file:
{"final": true, "verdict": "approve|request_changes", "summary": "two or three sentences on the pull request as a whole", "findings": [{"key": "short-stable-slug", "severity": "high|medium|low", "path": "file", "line": 123, "title": "one line", "scenario": "concrete input/state -> wrong result, and who it hurts", "evidence": "what you ran and what it printed, or the exact lines", "fix": "the smallest correct fix", "passes": ["which passes found it"]}], "dropped": [{"key": "candidate key", "reason": "why it was dropped"}]}
