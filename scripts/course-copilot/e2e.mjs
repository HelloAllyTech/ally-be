#!/usr/bin/env node
/**
 * Course Copilot end-to-end driver against a running ally-be (local stack).
 *
 * Drives a whole session through the real API with the real models: answers
 * every question with its recommended option (or a scripted answer), asks for
 * the blueprint, approves it, polls the build to completion and checks the
 * course it made. Prints a timeline and exits non-zero on the first failure.
 *
 *   node scripts/course-copilot/e2e.mjs                       # interview from scratch
 *   OTP=<test-account code> node scripts/course-copilot/e2e.mjs   # OTP is required
 *   BASE=http://localhost:8001/api EMAIL=admin@example.com OTP=… node scripts/course-copilot/e2e.mjs
 *   SESSION=<uuid> node scripts/course-copilot/e2e.mjs        # resume an existing session
 *   MAX_QUESTIONS=6 node scripts/course-copilot/e2e.mjs       # fast-forward after 6 answers
 *   EDIT="make the first quiz harder" node …                  # one edit-loop turn after the build
 *
 * Needs working provider keys in ally-be/.env. Costs real money (a few dollars
 * for a course with new roleplays).
 */

const BASE = process.env.BASE ?? 'http://localhost:8001/api';
const EMAIL = process.env.EMAIL ?? 'admin@example.com';
// The local test account's fixed code (TEST_ACCOUNTS in ally-be/.env) — passed
// in, never written here.
const OTP = process.env.OTP;
const ROLES = (process.env.ROLES ?? 'SUPER_DUPER_ADMIN,PLATFORM_ADMIN').split(',');
const MAX_QUESTIONS = Number(process.env.MAX_QUESTIONS ?? 8);
const BUILD_TIMEOUT_MS = Number(process.env.BUILD_TIMEOUT_MS ?? 15 * 60_000);
const SEED =
  process.env.SEED ??
  'A short course for volunteer listeners on a text helpline: recognising when someone is in crisis and responding with empathy, then handing over safely. Use library roleplays where they fit; no new roleplays.';

const started = Date.now();
const log = (...args) =>
  console.log(`[${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s]`, ...args);
const fail = (message) => {
  console.error(`\nFAILED: ${message}`);
  process.exit(1);
};

let token;

async function auth() {
  if (!OTP) fail('Set OTP to the local test account code (TEST_ACCOUNTS in ally-be/.env).');
  const body = { email: EMAIL, allowedRoles: ROLES, appType: 'ADMIN' };
  await fetch(`${BASE}/v2/auth/generate-otp`, post(body));
  const response = await fetch(`${BASE}/v2/auth/verify-otp`, post({ ...body, otp: OTP }));
  const json = await response.json();
  if (!json.accessToken) fail(`login: ${JSON.stringify(json)}`);
  token = json.accessToken;
}

function post(body) {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  };
}

async function api(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!response.ok) fail(`${method} ${path} → ${response.status}: ${text.slice(0, 800)}`);
  return json;
}

/** One SSE turn; returns the frames. */
async function turn(sessionId, message, extra = {}) {
  const response = await fetch(
    `${BASE}/v1/course-copilot/sessions/${sessionId}/messages/stream`,
    post({ message, ...extra }),
  );
  if (!response.ok) fail(`stream → ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const frames = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\r?\n\r?\n/);
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const event = chunk.match(/^event: (.*)$/m)?.[1];
      const data = chunk.match(/^data: (.*)$/m)?.[1];
      if (!event || !data) continue;
      frames.push({ event, data: JSON.parse(data) });
    }
  }
  const text = frames
    .filter((f) => f.event === 'token')
    .map((f) => f.data.delta)
    .join('');
  if (text.trim()) log(`  copilot: ${text.trim().slice(0, 300).replace(/\s+/g, ' ')}`);
  for (const frame of frames) {
    if (frame.event === 'tool_result') log(`  tool ${frame.data.name}: ${frame.data.summary}`);
    if (frame.event === 'error') log(`  ERROR ${frame.data.code}: ${frame.data.message}`);
  }
  return frames;
}

function answerFor(question) {
  const options = question.options ?? [];
  const pick = options.find((o) => o.recommended) ?? options[0];
  if (!pick) {
    return { message: 'You decide — pick what you would recommend.', questionId: question.id };
  }
  return {
    message: pick.label,
    questionId: question.id,
    answer: { selectedOptionIds: [pick.id] },
  };
}

async function main() {
  await auth();
  let sessionId = process.env.SESSION;
  if (!sessionId) {
    const session = await api('POST', '/v1/course-copilot/sessions', {});
    sessionId = session.id;
    log(`session ${sessionId}`);
  }

  // Resuming a session that already has a blueprint (or a course): skip the interview.
  const existing = process.env.SESSION
    ? await api('GET', `/v1/course-copilot/sessions/${sessionId}`)
    : null;
  const resumeAt = existing?.session.status;
  let frames = resumeAt && resumeAt !== 'INTERVIEWING' ? [] : await turn(sessionId, SEED);
  let asked = 0;
  for (let guard = 0; guard < 30 && frames.length; guard++) {
    const done = frames.find((f) => f.event === 'done')?.data;
    const errored = frames.find((f) => f.event === 'error');
    if (errored) fail(`turn errored: ${errored.data.code} ${errored.data.message}`);
    if (done?.sessionStatus === 'AWAITING_BLUEPRINT') break;
    const question = frames.find((f) => f.event === 'question')?.data;
    if (!question || asked >= MAX_QUESTIONS) {
      log('→ fast-forward');
      frames = await turn(
        sessionId,
        'Just build it — fill anything still open with sensible defaults and show me the blueprint.',
      );
      continue;
    }
    asked += 1;
    const answer = answerFor(question);
    log(`Q${asked}: ${question.prompt}\n         → ${answer.message}`);
    frames = await turn(sessionId, answer.message, {
      questionId: answer.questionId,
      ...(answer.answer ? { answer: answer.answer } : {}),
    });
  }

  let detail = await api('GET', `/v1/course-copilot/sessions/${sessionId}`);
  if (detail.session.status === 'AWAITING_BLUEPRINT') {
    await approveAndBuild();
  } else if (detail.session.status !== 'BUILDING' && detail.session.status !== 'EDITING') {
    fail(`expected AWAITING_BLUEPRINT, got ${detail.session.status}`);
  }
  await watchBuild();
  return;

  async function approveAndBuild() {
  if (detail.session.status !== 'AWAITING_BLUEPRINT') {
    fail(`expected AWAITING_BLUEPRINT, got ${detail.session.status}`);
  }
  const blueprint = detail.session.blueprint;
  log(
    `blueprint v${detail.session.blueprintVersion}: "${blueprint.title}" — ${blueprint.sections.length} sections, ` +
      `${blueprint.estimate.items} items, ~$${blueprint.estimate.usd}`,
  );
  for (const section of blueprint.sections) {
    log(`  § ${section.title}`);
    for (const item of section.items) log(`     - ${item.type} ${item.title} [${item.source.kind}]`);
  }

  const approved = await api('POST', `/v1/course-copilot/sessions/${sessionId}/blueprint/approve`, {
    version: detail.session.blueprintVersion,
  });
  log(`approved → course ${approved.session.trackId}, ${approved.jobs.length} jobs`);
  }

  async function watchBuild() {

  const deadline = Date.now() + BUILD_TIMEOUT_MS;
  let lastSeq = 0;
  for (;;) {
    detail = await api('GET', `/v1/course-copilot/sessions/${sessionId}?afterSeq=${lastSeq}`);
    for (const event of detail.events) {
      lastSeq = Math.max(lastSeq, event.seq);
      const p = event.payload;
      log(`  [${event.type}] ${p.title ?? ''} ${p.summary ?? p.error ?? p.reason ?? ''}`.trim());
    }
    if (detail.session.status !== 'BUILDING') break;
    if (Date.now() > deadline) fail('build timed out');
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  log(`build finished: status ${detail.session.status}, spent $${detail.budget.spentUsd}`);
  const counts = detail.jobs.reduce((acc, job) => ({ ...acc, [job.status]: (acc[job.status] ?? 0) + 1 }), {});
  log(`jobs: ${JSON.stringify(counts)}`);
  for (const job of detail.jobs.filter((j) => j.status !== 'done')) {
    log(`  ${job.status} ${job.kind} "${job.title}": ${job.error ?? job.skippedReason ?? ''}`);
  }
  const outline = detail.outline;
  if (!outline) fail('no outline after the build');
  for (const section of outline.sections) {
    log(`  § ${section.order}. ${section.title}`);
    for (const item of section.items) log(`     ${item.order}. ${item.type} ${item.title} — ${item.size}`);
  }
  log(`readiness: ${detail.readiness.ready ? 'ready' : detail.readiness.checks.filter((c) => !c.ok).map((c) => c.label).join(', ')}`);
  const review = [...detail.messages].reverse().find((m) => m.metadata?.reviewNotes);
  if (review) log(`review: ${review.metadata.reviewNotes.findings.length} findings`);

  if (process.env.EDIT) {
    log(`edit turn: ${process.env.EDIT}`);
    frames = await turn(sessionId, process.env.EDIT);
    const patches = frames.filter((f) => f.event === 'course_patch');
    log(`course patches: ${patches.map((p) => p.data.summary).join(' | ') || 'none'}`);
  }
  log(`done — session ${sessionId}, course ${detail.session.trackId}`);
  }
}

main().catch((error) => fail(error?.stack ?? String(error)));
