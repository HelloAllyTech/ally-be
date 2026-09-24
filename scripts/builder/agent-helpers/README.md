# Agent helpers — the reporting protocol, as real commands

Every file here is an executable on the agent's `PATH`, put there by
`run-engine.sh`. The build prompt documents them as commands to run.

## Why these are files and not shell functions in the prompt

They used to be `stage() { curl … }` function *definitions*, embedded verbatim
in the prompt for every role. That only works if the agent pastes the whole
body into each shell it opens, because a coding agent's shell tool spawns a
fresh shell per call and nothing survives between them.

Claude Code happens to do that. Gemini did not — it read the documentation and
ran `stage REMEDIATING`, which is exactly what the prompt appears to describe:

    $ stage REMEDIATING
    bash: line 1: stage: command not found

It got that back eight times in one run and carried on regardless, because
every helper ends in `|| true` and telemetry is not allowed to fail a build.
So the run coded, tested and committed while the progress rail sat frozen on
the stage it had reached an hour earlier, and no gate result was ever posted.

The prompt was not wrong and the agent was not disobedient. The protocol was
merely being *described* when it could be *installed*. A command on PATH is
true for every engine, in every shell, without anyone following instructions.

## The contract

- `ALLY_BE_API_URL` and `BUILDER_RUN_ID` come from the job env.
- `ALLY_BE_API_KEY` authenticates.
- Each is telemetry and swallows its own failure — with one exception,
  `complete`, which reports whether the call landed. A run whose outcome POST
  silently failed is recorded as a run that never reported one.
