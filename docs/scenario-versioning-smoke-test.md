# Scenario Versioning — draft-config report smoke test

Most of the versioning backend is covered by unit tests. The **one thing Jest
cannot assert** is that a report/preview generated against an *unpublished
draft* version actually drives the `ally-ai-learn` agent with the **draft's**
config (prompt/persona/states) rather than the live scenario's. The whole
"compare versions by running them" feature rests on this, so verify it once
end-to-end against the running Docker stack.

The chain under test:

```
POST .../reports {scenarioVersionId}                      (ally-be)
  → ScenarioReportService.createScenarioReport
  → ScenarioSharedService.buildScenarioOverrideFromVersion   (hydrate draft config)
  → createMetadataForScenario(..., override)                 (build room metadata)
  → AiService.triggerScenarioReportGenerate({metadata})       (HTTP POST → ally-ai-learn)
```

## Prereqs

- Stack up: `ally-be-app-1` (`:8001`), `ally-ai-learn-app` (`:8002`), `ally-be-postgres-1` (`:5477`).
- Migration applied (`scenario_versions` table exists).
- An admin bearer token. Set:

```bash
export TOKEN='<admin access token>'
export BE='http://localhost:8001/api/v1'
export PG='docker exec ally-be-postgres-1 psql -U postgres -d ally_local -At'
```

Pick a scenario id you own that already passes mandatory-field validation
(it must be publishable). `export SID=<scenarioId>`.

## Step 1 — create a draft with a UNIQUE marker

The marker must be something that surfaces in the agent's behaviour/transcript.
A distinctive persona name + opening line works well.

```bash
# Branch a fresh draft from the live/published version
VID=$(curl -s -X POST "$BE/learn/scenarios/$SID/versions" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"smoke-test draft"}' | jq -r .id)
echo "draft=$VID"

# Read it, mutate the marker fields, autosave the whole config back.
# (Re-PUT the full config object; here we just patch two fields for clarity.)
curl -s -X PUT "$BE/learn/scenarios/$SID/versions/$VID" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"config":{"name":"ZZMARKER_PERSONA","openingStatements":"ZZMARKER opening line","prompt":"You are ZZMARKER, always mention the word ZZMARKER in your first reply."}}'
```

> The PUT body's `config` is the full `UpdateScenarioDto` snapshot. In the real
> studio the editor sends the complete object on autosave; for the smoke test a
> partial patch is fine as long as the live scenario already has the mandatory
> fields (they're merged from the branched config).

## Step 2 — confirm the live scenario is UNCHANGED

This proves edit/publish are decoupled — editing a draft must not touch the
live row.

```bash
$PG -c "select metadata->>'name' from scenarios where id=$SID;"   # must NOT be ZZMARKER_PERSONA
$PG -c "select status, \"publishedVersionId\" from scenarios where id=$SID;"
```

## Step 3 — generate a report against the DRAFT

```bash
RID=$(curl -s -X POST "$BE/learn/scenarios/$SID/reports" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"languageId\":1,\"turns\":3,\"helperAgentPrompt\":\"probe\",\"scenarioVersionId\":\"$VID\"}" | jq -r .id)
echo "report=$RID"
```

## Step 4 — verify (the actual assertions)

**4a. The report row is tagged with the draft version** (attribution):

```bash
$PG -c "select \"scenarioVersionId\" from scenario_reports where id='$RID';"
# expect: $VID
```

**4b. The metadata dispatched to ally-ai-learn carries the DRAFT marker** —
this is the core check. Watch the learn worker's logs for the inbound payload:

```bash
docker logs -f ally-ai-learn-app 2>&1 | grep -i "ZZMARKER\|$RID"
```

You should see `ZZMARKER` in the received room metadata / system prompt. If you
see the LIVE persona name instead, the override is NOT being applied — stop and
fix before building UI on top.

**4c. The generated transcript/report reflects the draft persona** (end-to-end
proof). After the report completes:

```bash
curl -s "$BE/learn/scenarios/$SID/reports/$RID" -H "Authorization: Bearer $TOKEN" | jq '{status, scenarioVersionId, metrics}'
# then read the transcript — the client agent should mention ZZMARKER
```

## Step 5 — control: report against the live scenario

Repeat Step 3 **without** `scenarioVersionId`. The report must:
- tag `scenarioVersionId` = the scenario's `publishedVersionId` (not null, not the draft), and
- run the LIVE persona (no ZZMARKER).

This confirms the no-version path is unchanged.

## Pass criteria

- [ ] 2: live scenario unchanged after draft edit
- [ ] 4a: draft report tagged with the draft `versionId`
- [ ] 4b: `ZZMARKER` present in ally-ai-learn inbound metadata for the draft run
- [ ] 4c: transcript reflects the draft persona
- [ ] 5: live run tagged with `publishedVersionId` and shows no marker

## Optional: preview (live-talk) path

Same idea via `POST /learn/scenarios/preview` with
`{"scenarioId":SID,"languageId":1,"scenarioVersionId":"$VID"}` — join the room
and confirm the agent speaks as ZZMARKER.
