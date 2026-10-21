#!/usr/bin/env node
//
// The knowledge pack, out of an `opencode run --format json` transcript.
//
// opencode has no terminal frame carrying the answer, so the document is
// reassembled from its `text` records, grouped by step. Which step is the
// document? This used to be the LAST step that wrote any text, on the theory
// that earlier steps are the agent narrating its exploration ("Let me read
// CLAUDE.md"). In production that picked the wrong one: the model wrote the
// pack and then signed off in a final step ("The knowledge pack is above."),
// and the sign-off became the map — 56 characters for ally-ai-learn, 658 for
// ally-mobile on 2026-10-21, refused by the floor, leaving stale maps in place.
//
// So the LONGEST step wins. Narration and sign-offs are a sentence; the pack is
// thousands of words. Errors and a per-step length summary go to stderr, so the
// next failure says what the model actually produced instead of only "too short".
//
// Usage: node map-text.mjs <transcript.jsonl>   (document on stdout)
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: map-text.mjs <transcript.jsonl>');
  process.exit(2);
}

const steps = [];
let current = null;
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    continue;
  }
  if (record?.type === 'step_start') {
    current = [];
    steps.push(current);
  } else if (record?.type === 'text' && record.part?.text?.trim()) {
    if (!current) {
      current = [];
      steps.push(current);
    }
    current.push(record.part.text);
  } else if (record?.type === 'error') {
    console.error(
      '[opencode] ' +
        (record.error?.data?.message ?? record.error?.name ?? 'unknown error'),
    );
  }
}

const texts = steps.map((parts) => parts.join('\n').trim());
const longest = texts.reduce((best, text) => (text.length > best.length ? text : best), '');
console.error(
  `[map] ${steps.length} step(s); text chars per step: ${
    texts.map((text) => text.length).join(', ') || 'none'
  }`,
);
process.stdout.write(longest);
