# Copilot-supported text chat helpline — implementation plan

**Date:** 2026-10-04 · **Status:** Draft for review · **Scope:** ally-be, ally-web (helpline + admin), ally-ai; ally-mobile later

> **Cross-repo plan.** It lives in `ally-be` because the backend does most of the work. Paths are
> relative to the workspace root (`ally-be/src/...`, `ally-web/apps/...`, `ally-ai/app/...`).
> Nothing here is implemented yet.
>
> **Sourcing note.** Stacks and the public wiki were unreachable from the session that wrote this
> (no Stacks key, egress to `tech.helloally.ai` blocked), so product guidance below comes from
> in-repo material only: `docs/foundational-helping-skills.md`, the WhatsApp bot's safety pipeline,
> the live-call nudge copilot, and ally-ai-learn's supervisor notes. Run `/stacks:planning_context`
> on this document before Phase 0 closes and fold in what comes back, especially on empty/waiting
> states, crisis copy and disclosure of AI assistance.

---

## 0. Decisions already taken

Answers given on 2026-10-04. Everything below is designed around them.

| # | Decision | Choice |
|---|---|---|
| 1 | Talker entry | **Public per-org link, fully anonymous, plus WhatsApp as a second channel.** Web first; WhatsApp is Phase 5. No account, no phone, no email on web. |
| 2 | Matching | **Queue + listener claims.** Talkers wait with a visible position; available listeners claim from a lobby. Auto-assign is a later option. |
| 3 | Access gating | **Org switch AND per-user role.** Platform admin flips `TEXT_HELPLINE_ENABLED` for an org (off by default). The org admin grants a new `LISTENER` group to specific users. No existing user gets access by default. |
| 4 | Copilot v1 | **All four:** risk/crisis detection + escalation protocol; editable suggested replies; sparse coaching nudges + stage; rolling summary + handoff note. |
| 5 | Crisis action | **Listener banner + supervisor alert + auto-send emergency resources to the talker.** |
| 6 | AI text to talker | **Humans only.** No LLM-written text ever reaches a talker. |
| 7 | Supervision v1 | **All four:** live read-only monitor; whisper to listener; transfer / take-over; post-chat QA scoring. |
| 8 | Retention | **Org-configurable, default 90 days**, bodies blanked after the window; talker gets a consent screen and can request deletion. |

**Reconciling 5 and 6.** The emergency-resources message is a *fixed, org-authored* system message
(per language, edited in admin settings, never model-generated). The risk detector decides *whether*
to send it, not *what* it says. It is sent at most once per chat, only on HIGH risk, and is labelled
as coming from the service, not the listener. That keeps the "humans only" promise intact: the
model never writes to a talker, it only triggers pre-written text the org has approved.

---

## 1. What already exists, and what we reuse

The text helpline was scaffolded years ago and abandoned when the product went audio-first. A lot of
the skeleton is still in the tree.

| Need | Exists today | Reuse decision |
|---|---|---|
| Conversation + message storage | `chats` / `messages` (`ally-be/src/chat/entity/`). `MessageType` already has `TEXT / SYSTEM / NUDGE / STAGE`; nudges are stored as child messages via `parentMessageId`; `ANONYMOUS_CLIENT_ID = -1` is the anonymous client convention | **Reuse.** Add a `channel` column and a `talkerId` FK (§3). Buys us call logs, per-message feedback, summary pipeline, custom fields, nudge storage |
| Waiting queue | `queue_entries` (`src/queue/`), only `enqueue` + `getStats` | **Repurpose.** Add claim columns; it is barely used |
| Socket events | `ChatEvents.SEND_MESSAGE`, `USER_TYPING`, `CHAT_ACCEPTED`, `MESSAGE_RECEIVED` in `src/chat/constants/chat.constants.ts` — dead | Reuse names in the new gateway |
| Copilot nudge + stage | `POST v1/chats/nudge` → ally-ai `POST /conversation/analyze` → `{stage, nudge}`; `NUDGE_STATUS` preference; `AiChatIntegrationService.triggerNudge()` (uncalled) | Reuse the endpoint and the on/off preference; new trigger path |
| Crisis detection | WhatsApp: keyword templates (`wa_keyword_templates`, kind `CRISIS`) → then ally-ai `POST /knowledge-agent/crisis-check` (temp 0, false-positive-biased, verbatim `signal`, `phi_logger` only) | Reuse the classifier **with a new helpline prompt**; generalise keyword matching into a shared module |
| Summaries | ally-ai `POST /summary` with dynamic keys; `SUMMARY_GENERATED_FROM_MESSAGES` audit event already exists | Reuse for rolling + final summary |
| Post-chat QA | `src/foundational-skills` judge scores 5,000-char slices of a helper's own speech against the 15-skill rubric | Reuse; add helpline chats as a cut source |
| Live coaching cadence | ally-ai-learn supervisor notes: hard timeout 6s, max 10 per session, min 2 turns between notes, 240 chars | Copy the sparsity rules into the copilot |
| Guest / anonymous access | **None.** JWT strategy rejects tokens without `tenantId`; sockets authenticate only user JWTs | **Build** a guest-token path (§4) |
| Org-level gating | `Preference` rows read by `TenantFeatureService.isEnabledForTenant` (fails closed) | Reuse for `TEXT_HELPLINE_ENABLED` |
| Per-user gating | `admin_feature_toggles` are platform-admin only | Don't use; a `LISTENER` group fits the roles model |
| Cross-replica fan-out | Redis pub/sub via `MessageBrokerService`; **no socket.io Redis adapter**, rooms are per replica | **Add `@socket.io/redis-adapter`** (§6) |
| Rate limiting | `@RateLimit` (Redis throttler) on HTTP only; per-phone windows for WhatsApp; nothing on WebSocket messages | Extend to guest session creation and socket messages |
| Retention blanking | `whatsapp-retention.service.ts` sweeps and blanks bodies in place, keeps counts | Copy the pattern |
| Notifications | FCM push, `in_app_notifications`, SES email, Slack | Reuse for supervisor alerts |
| Frontend chat UI | No human-to-human chat. Pieces: `ReplyBubble`, `AutoExpandableTextarea`, `CallSidebar` nudge card with thumbs feedback, `useSocket`/`useAllySocket` | Reuse components; the admin app's `useAllySocket` is the better socket hook to port |
| Public pages | `PublicRouteLayout` (bare outlet) serves login, terms, SJT pages | Talker page goes here |

**Not reused:** the WebRTC/audio paths; `scenario_session_chats` (SSE debrief chat, a different shape);
`conversational_guardrails` (built for steering an AI actor, not a human listener).

---

## 2. Roles, access and the gate

### 2.1 Three new permission bundles

Permission names follow the existing `verb:noun` style in `src/authorization/constants/permissions.constants.ts`.

| Group (new) | Permissions | Who grants it |
|---|---|---|
| `LISTENER` | `view:helpline:lobby`, `edit:helpline:presence`, `edit:helpline:claim`, `view:helpline:chat`, `edit:helpline:message`, `edit:helpline:end`, `view:helpline:copilot`, `edit:helpline:summary` | Org ADMIN from Org Settings → access management (helpline dashboard), and platform admins |
| `HELPLINE_SUPERVISOR` | all LISTENER permissions + `view:helpline:monitor`, `edit:helpline:whisper`, `edit:helpline:transfer`, `view:helpline:qa` | Same |
| tenant `ADMIN` (existing) | gains the supervisor set + `edit:helpline:settings` | Migration |

Backend gate on every helpline route and the gateway handshake: **permission AND
`TEXT_HELPLINE_ENABLED` for the user's tenant**. Add a small `@RequireTenantFeature(PreferenceName)`
guard next to `@RequireFeatureToggle` (which is keyed on admin toggles and doesn't fit non-admin users)
and compose it with `@AuthPermissions`. Fails closed when the preference row is missing.

### 2.2 Gotchas this touches (from `CLAUDE.md` and the auth history)

- **Login `allowedRoles`.** ally-web sends an `ALLOWED_ROLES` list with OTP/Google login. A user whose
  *only* group is `LISTENER` cannot log in until `LISTENER` is in that list in **ally-web and
  ally-mobile**. Mitigation: ship `LISTENER` to both allow-lists in the same release, and in v1 grant
  `LISTENER` additively to users who already hold COUNSELOR or LEARNER.
- **Grants are migration-written.** The `...PERMISSIONS` spreads are TypeScript only. The migration
  must insert `permissions`, `groups` and `group_permissions` rows itself, idempotently, in the style
  of `1937200000000-AddBuilderPermissions.ts` and `1968000000000-CreateEvaluatorRole.ts`.
- **30-minute permission cache.** Role grants via the service bust `user:groups:` /
  `user:roles:` keys; the migration can't, so expect up to 30 min lag after deploy for ADMIN's new
  supervisor permissions.
- **Gate on `roles`, never `role`.** The lossy single `role` from `GET /users/me` must not decide
  listener access anywhere in the UI.

### 2.3 Platform-admin surface

Org detail page in the admin console gets a **Text helpline** toggle (same pattern as
`CHARACTER_LIBRARY_ENABLED`) and a settings card (§8). Flipping it on does nothing for users until the
org admin grants roles. Flipping it off hides the entry point, refuses new talker sessions, and lets
active chats finish.

---

## 3. Data model

All new tables extend `BaseEntity` (tenant-scoped) unless noted. Every repository query filters on
`tenantId`; a talker's chat is further scoped by `talkerId` from the guest token.

### 3.1 Changes to existing tables

| Table | Change |
|---|---|
| `chats` | `channel` enum: `AUDIO_MICROPHONE`, `AUDIO_UPLOAD`, `CLOUD_TELEPHONY`, `TEXT_WEB`, `TEXT_WHATSAPP` (backfill existing rows from `metadata`); `talkerId uuid null`; `claimedAt`, `lastTalkerMessageAt`, `lastListenerMessageAt`, `endedReason` enum (`LISTENER_ENDED`, `TALKER_ENDED`, `TALKER_IDLE`, `TALKER_DISCONNECTED`, `SUPERVISOR_ENDED`, `TENANT_DISABLED`), `riskLevel` (`NONE`/`ELEVATED`/`HIGH`, denormalised max) |
| `messages` | New `MessageType` values: `SUGGESTION` (copilot draft, child of the talker message, metadata `{accepted, editedDistance}`), `WHISPER` (supervisor → listener; **never emitted to a talker socket**), `RISK` (detector result, child of the talker message), `TRANSFER`. New `senderRole` column (`TALKER`/`LISTENER`/`SUPERVISOR`/`SYSTEM`/`COPILOT`) so a `null senderId` is unambiguous. `clientMessageId` (uuid, unique per chat) for idempotent resend |
| `queue_entries` | `talkerId uuid`, `claimedBy int null`, `claimedAt`, `abandonedAt`, `status` adds `CLAIMED`/`ABANDONED`/`EXPIRED`; `priority` is bumped to 100 on HIGH risk while waiting |

Scribe and telephony code paths filter on `channel IN (audio channels)` where they list "calls", so text
chats don't leak into Scribe's call-log views (and vice versa). The `HIDDEN_CHAT_TYPES` preference
already exists for per-counsellor hiding; text chats get their own type key.

### 3.2 New tables

| Table | Purpose | Key columns |
|---|---|---|
| `helpline_talkers` | One row per anonymous talker session (web) or WhatsApp contact (later) | `id uuid`, `channel`, `displayName`, `language`, `tokenHash` (sha-256 of the guest token; rotation = new row), `consentAcceptedAt`, `consentVersion`, `ipHash` (salted, for abuse windows only), `userAgent`, `lastSeenAt`, `blockedAt`, `blockedBy`, `erasedAt`, `waContactId uuid null` |
| `helpline_listener_profiles` | Per-listener settings | `userId`, `maxConcurrentChats` (default 2, ≤ org cap), `languages text[]`, `active bool` |
| `helpline_risk_flags` | Every detector result that reached ELEVATED or HIGH | `chatId`, `messageId`, `level`, `source` (`KEYWORD`/`CLASSIFIER`), `confidence`, `signalStart`/`signalEnd` (**offsets into the message body, not the text**, so retention blanking covers it), `resourcesSentAt`, `acknowledgedBy`, `acknowledgedAt`, `outcome` (`CONFIRMED`/`FALSE_POSITIVE`/`UNREVIEWED`) |
| `helpline_risk_keyword_rules` | Tenant keyword layer | `phrase`, `language`, `matchType` (same split as `WaTemplateMatchType`), `level`, `enabled`. Seeded with platform defaults (`isGlobal`) |
| `helpline_chat_events` | Timeline for monitor and audit | `chatId`, `type` (`ENQUEUED`, `CLAIMED`, `TALKER_RECONNECTED`, `TRANSFER_REQUESTED`, `TRANSFERRED`, `TAKEN_OVER`, `RESOURCES_SENT`, `RISK_ACKNOWLEDGED`, `ENDED`, `ERASURE_REQUESTED`), `actorUserId`, `payload jsonb` (no message bodies) |
| `helpline_chat_summaries` | Rolling and final summaries | `chatId`, `kind` (`ROLLING`/`HANDOFF`/`FINAL`), `content jsonb`, `throughMessageId`, `editedBy`, `version` |
| `helpline_qa_scores` | Post-chat foundational-skills result | `chatId`, `listenerId`, `rubricVersion`, `levels jsonb` (skill → 1–4), `evidence jsonb` (message ids + offsets), `judgeModel` |
| `helpline_talker_feedback` | Optional one-question end-of-chat rating | `chatId`, `rating 1–5`, `comment` (blanked by retention) |

Org settings live in a `Preference` row `TEXT_HELPLINE_SETTINGS` (jsonb, §8) next to the
`TEXT_HELPLINE_ENABLED` gate; no table needed. Listener presence lives in **Redis**, not Postgres (§6).

`DATA_SCHEMA.md` gets a new §3.x "Text helpline" domain and index entries; `.docs-map.yml` enforces it.

---

## 4. Guest (talker) authentication

A talker never has a user row. They get a **guest JWT** signed with a separate secret and audience
`helpline-guest`, claims `{talkerId, chatId, tenantCode, channel}`, TTL 24h, refreshed on each
reconnect while the chat is open. The existing `JwtStrategy` never sees it: guest routes use a
`GuestJwtStrategy` + `HelplineGuestGuard`, and the socket middleware tries user JWT first, guest JWT
second (§6).

```
POST   /v1/helpline/public/:tenantCode/session        create talker + chat(WAITING) + queue entry → {guestToken, consent, queuePosition, resources}
GET    /v1/helpline/public/:tenantCode/status         is the helpline open? listeners available? estimated wait   (@Public, cached 10s)
GET    /v1/helpline/guest/chat                        my chat + messages since ?afterId (reconnect resync)
POST   /v1/helpline/guest/end                         talker ends
POST   /v1/helpline/guest/erase                       right to erasure: blank bodies now, keep metadata, revoke token
POST   /v1/helpline/guest/feedback                    one-question rating
```

Protection on `session`: `@RateLimit({name:'helpline-guest', key:'ip', limit:5, ttl:3600})` plus a
per-tenant cap on simultaneous WAITING talkers (default 50) and a global kill switch
(`config.featureFlag.textHelpline`). A Cloudflare Turnstile check is an optional Phase 6 hardening
step; start without it and watch the abuse numbers.

What the talker sees before the token exists: the **consent screen** (§7.1). The session is created
only after they accept, so no row exists for a bounce.

---

## 5. Chat lifecycle

```
Talker                         Server                                  Listener
  │  accept consent, name         │                                        │
  ├──POST session────────────────►│ create talker, chat(WAITING), queue    │
  │◄─token, position, resources───┤ emit QUEUE_UPDATED → tenant lobby ────►│ lobby shows new talker
  ├──connect /helpline-chat (guest token) → room chat-{id}                 │
  │  may type a first message while waiting (stored, previewed in lobby)   │
  │                               │◄──────────────── CLAIM chat-{id} ──────┤ atomic claim
  │◄─CHAT_ACCEPTED (listener display name)  chat ACTIVE, queue CLAIMED ───►│ joins room chat-{id}
  │◄──────────────────── SEND_MESSAGE / MESSAGE_RECEIVED / TYPING ────────►│
  │                               │ per talker msg: risk screen ─► RISK ──►│ banner (+ supervisor alert, + resources to talker on HIGH)
  │                               │ copilot turn ─► SUGGESTION, NUDGE, STAGE ─►│ copilot panel
  │                               │ every N turns: ROLLING summary ───────►│
  │◄─ CHAT_ENDED (closing text) ──┤◄──────────────── END ──────────────────┤ summary review → FINAL
  │  feedback (optional)          │ QA judge (async) ─► helpline_qa_scores  │
```

**Claiming** is one SQL statement, `UPDATE queue_entries SET status='CLAIMED', claimedBy=$u,
claimedAt=now() WHERE entryId=$e AND status='WAITING' RETURNING *`, so two listeners can't win. The
claim also checks the listener's current ACTIVE count against `maxConcurrentChats`.

**States and timers** (all configurable per org, defaults shown):

| Situation | Behaviour |
|---|---|
| No listener AVAILABLE when talker arrives | Status endpoint says closed; talker sees the **after-hours state** with resources and hours. No queue entry is created (`allowQueueWhenNoListeners: false` default). |
| Talker waiting > `maxWaitMinutes` (30) | Entry `EXPIRED`; talker shown resources and "try again" copy; lobby row disappears. |
| Talker socket gone > 2 min while WAITING | Entry `ABANDONED`. Reconnecting with the token within 10 min restores the position. |
| Talker socket gone while ACTIVE | Listener sees "talker disconnected"; chat stays ACTIVE for `idleEndMinutes` (15) then ends `TALKER_DISCONNECTED`. Reconnect resumes seamlessly (`GET guest/chat?afterId`). |
| Listener socket gone while ACTIVE | Talker sees "your listener is reconnecting"; after 3 min the chat is flagged in the monitor for transfer; after 10 min a supervisor is alerted. |
| Listener sets AWAY/OFFLINE with active chats | Allowed; they keep their chats, just stop receiving the lobby. |
| Org toggle turned off | New sessions refused; active chats finish normally. |
| HIGH risk while WAITING | Priority 100, lobby row highlighted, supervisors alerted even though nobody has claimed. |

**Ending.** Either side can end. Listener end opens the summary review (FINAL summary pre-filled by
the copilot, editable, saved with `editedBy`). Talker end sends a fixed closing message and the
feedback prompt. Transcript access after end: listener and supervisors of that org only, audited with
`ACCESS_TRANSCRIPT`.

---

## 6. Real-time layer

**New gateway** `src/helpline/gateway/helpline-chat.gateway.ts`, namespace `/helpline-chat`.

- **Dual auth middleware.** Extend `WebSocketAuthMiddleware` with a guest branch: if the token
  verifies as a guest JWT, attach `{talkerId, chatId, tenantCode}` and restrict the socket to
  `chat-{chatId}` only. User tokens go through the existing permission check (`view:helpline:chat`)
  plus the tenant feature gate.
- **Rooms.** `chat-{id}` (talker + listener + monitoring supervisors), `lobby-{tenantCode}`
  (available listeners + supervisors), `user-{id}` (direct: whispers, alerts). Supervisors in a
  `chat-{id}` room are flagged `readOnly`; the gateway drops any `SEND_MESSAGE` from them unless they
  have taken over. **`WHISPER` is emitted to `user-{listenerId}` only, never to the chat room.**
- **Socket.IO Redis adapter.** Two-party chat means the two sockets routinely land on different
  replicas, so per-replica rooms are not viable. Install `@socket.io/redis-adapter` on the Nest IO
  adapter for all namespaces (existing gateways keep working, and `MessageBrokerService` remains for
  non-socket fan-out like stream finalisation).
- **Presence.** `SET helpline:presence:{tenant}:{userId} {status,maxConcurrent} EX 45`, refreshed by a
  15s heartbeat; `AVAILABLE` requires a live key. Lobby counts come from a `SCAN`-free sorted set per
  tenant. Nothing in Postgres for presence.
- **Idempotency and resync.** Every `SEND_MESSAGE` carries `clientMessageId`; the server acks with
  the persisted `id`. On reconnect the client sends `SYNC_SINCE {afterId}` and gets the gap.
- **Per-socket rate limit.** 1 message/sec sustained, burst 5, 2,000 chars max; over the limit the
  server acks with `ERROR rate_limited` and drops the message. Typing events are throttled client-side
  to one per 2s and never persisted.
- **Events** (reuse `ChatEvents` names where they exist): `SEND_MESSAGE`, `MESSAGE_RECEIVED`,
  `USER_TYPING`, `USER_STOPPED_TYPING`, `CHAT_ACCEPTED`, `CHAT_ENDED`, `QUEUE_UPDATED`,
  `PRESENCE_UPDATED`, `RISK_FLAGGED`, `SUGGESTIONS`, `NUDGE`, `STAGE`, `SUMMARY_UPDATED`, `WHISPER`,
  `TRANSFER_REQUESTED`, `TRANSFERRED`, `SYNC_SINCE`, `ERROR`.

---

## 7. Frontends

### 7.1 Talker page (ally-helpline-dashboard, public, mobile-first)

Route `/talk/:tenantCode` under `PublicRouteLayout`. No nav, no login, org logo from `tenants.logoUrl`.

1. **Consent screen.** What this is (a text chat with a trained listener from *org*), what it is
   **not** (not an emergency service; emergency numbers shown right here), that the listener is
   supported by AI tools that read the conversation to help them respond and spot risk, that nothing
   is written to you by an AI, retention (`N days`, then deleted), that you can ask for deletion at any
   time, and the limits of confidentiality (**never an unconditional promise**, per the helping-skills
   rubric §1.5). Display name (optional, "Anonymous" default) and language. One button: *Start chat*.
2. **Waiting screen.** Position in queue ("You're 2nd in line"), estimated wait when we have data,
   the resources card, a composer so they can start typing what's on their mind (stored, shown to
   listeners as a preview), and *Leave*.
3. **After-hours / closed state.** Hours (if the org set them), resources, and a plain sentence that
   nobody is available right now. No queue entry.
4. **Chat screen.** Bubbles, typing indicator, delivered ticks, system messages styled distinctly
   (accepted, listener reconnecting, resources, transfer), a **Quick exit** button that replaces the
   tab with a neutral page (standard on helpline sites), *End chat*, and a kebab with *Delete my
   conversation*.
5. **Ended screen.** Closing text, one-question rating, resources, *Delete my conversation*.

i18n: en, hi, mr, ta, kn via the existing i18next setup; keys in `en.json`, then `npm run i18n:sync`
**with** the key. The guest token lives in `sessionStorage` (tab-scoped by design: closing the tab
ends resumability, which is the privacy trade-off that goes with "fully anonymous").

PostHog: anonymous distinct id (`anonymousDistinctId()` on the server, nothing identifying),
events `talker_session_started`, `talker_queue_left`, `talker_chat_ended`, `talker_feedback_submitted`.
Register them in `docs/current-posthog-events-traking-list.md`.

### 7.2 Listener workspace (ally-helpline-dashboard, gated)

Nav tab **Helpline** via a `useCanUseTextHelpline` hook (permission AND org toggle, same escape hatch
as `useCanViewCharacterLibrary`). Routes `/helpline` and `/helpline/chat/:chatId`.

- **Lobby.** Presence switch (Available / Away) with current load `1/2`; waiting list sorted by
  priority then wait time, each row: display name, language, wait time, risk badge, first-message
  preview, *Claim*. My active chats as tabs with unread counts. Browser notification + sound when a
  talker joins while Available (opt-out in profile).
- **Chat view, three columns** (collapsible like `CallSidebar`):
  - *Transcript + composer.* `AutoExpandableTextarea`, Enter to send, Shift+Enter newline. A
    suggestion inserts into the composer, never sends.
  - *Copilot panel.* Top: **risk banner** (persistent until acknowledged, shows the signal phrase,
    level, source, and the escalation checklist from org settings: ask directly about safety, ask
    about means/plan/timeframe, share resources, loop in a supervisor, don't end the chat). Then
    **suggestions** (2–3 drafts, in the talker's language, each with the skill it exercises as a tag,
    e.g. *Reflect feeling*, *Open question*; thumbs feedback reuses `feedback`). Then **nudge + stage**
    card (same as `CallSidebar`). Then **rolling summary** (presenting concern, feelings, risk,
    what's been tried, agreed next step). Then **whispers** from supervisors.
  - *Talker info.* Display name, language, wait time, consent version, channel, flags; actions:
    *Request transfer*, *Block talker* (supervisor-confirmed).
- **End flow.** Summary review modal (final summary pre-filled, editable fields = the org's summary
  keys), *Save and close*. Then the chat appears in **Chat logs** (the existing call-log page with a
  channel filter).
- **Wellbeing.** After a HIGH-risk chat ends, show a short "take a minute" interstitial and a link to
  the org's listener support contact (org setting). Cheap, and the helping-skills doc's "ready to
  help" attitude blocker is about exactly this.

### 7.3 Supervisor monitor (ally-helpline-dashboard, gated on `view:helpline:monitor`)

Route `/helpline/monitor`. Live tiles: waiting, active, listeners available, open HIGH flags. Table of
active chats (listener, talker, duration, risk, last message age) → open **read-only** with a *Whisper*
composer and *Take over* / *Transfer to…*. Queue table with *Assign to…*. Listener presence table.
QA tab: recent `helpline_qa_scores` with the strengths → improvements → positive close framing the
rubric mandates; **never a leaderboard** (rubric §1.3: group feedback names trends, not individuals).

### 7.4 Admin console (ally-admin-dashboard)

Org detail: **Text helpline** toggle + settings form (§8), with tooltips on every non-obvious field per
the ally-web `CLAUDE.md` rule. Prompts for the copilot appear automatically in prompt management once
synced from ally-ai. New AI Tasks rows appear automatically from the registry.

---

## 8. Org settings (`TEXT_HELPLINE_SETTINGS` preference, jsonb)

```jsonc
{
  "retentionDays": 90,                     // 0 = never blank (explicit opt-out, logged)
  "hours": null,                           // or { "tz": "Asia/Kolkata", "weekly": [...] }; null = whenever a listener is Available
  "allowQueueWhenNoListeners": false,
  "maxWaitMinutes": 30,
  "idleEndMinutes": 15,
  "maxWaitingTalkers": 50,
  "orgMaxConcurrentPerListener": 3,
  "emergencyResources": { "en": "...", "hi": "...", "mr": "...", "ta": "...", "kn": "..." },   // the auto-sent HIGH-risk message
  "closingMessage": { "en": "..." },
  "escalationChecklist": ["...", "..."],
  "supervisorAlertChannels": { "inApp": true, "push": true, "slackWebhook": null },
  "listenerSupportContact": "...",
  "copilot": { "suggestions": true, "nudges": true, "rollingSummaryEveryTurns": 4 },
  "whatsapp": { "enabled": false, "phoneNumberId": null }                                         // Phase 5
}
```

Platform defaults for `emergencyResources` ship with Indian national lines (Tele-MANAS 14416 /
1-800-891-4416, KIRAN 1800-599-0019, emergency 112). **Verify these numbers before seeding**; they
are listed here from memory, not from a source reachable in this session.

---

## 9. The copilot

### 9.1 Where it runs

Talker-message-time work runs in **ally-ai** (the crisis classifier and nudge retrieval already live
there, and prompts are overridable from ally-be prompt management). Post-chat QA runs in **ally-be**
(the foundational-skills judge already lives there). Summaries use ally-ai's existing `/summary`.

ally-ai gains `app/core/helpline/` and `app/api/v1/endpoints/helpline.py`:

| Endpoint | Purpose | Model class | Budget |
|---|---|---|---|
| `POST /helpline/risk` | Keyword hits are decided in ally-be first (instant). This is the second layer: classifier with a **new talker-facing prompt** `app/prompts/helpline/crisis_classify.txt` (the existing one is framed for "a worker asking a Q&A bot" and would misread talkers). Returns `{level, confidence, signal, failed}`; always 200 | fast, temp 0 | ≤ 1.5s, hard timeout 3s |
| `POST /helpline/turn` | One structured call: `{stage, nudge?, suggestions[2-3]{text, skillKey}}`. Prompt `helpline/copilot_turn.txt` grounded in the Engage-tier behaviours of `docs/foundational-helping-skills.md`, the talker's language, and the rolling summary. Nudge is included only when the sparsity rule allows (below) | fast | ≤ 3s, hard timeout 6s |
| `POST /summary` (existing) | Rolling summary every `rollingSummaryEveryTurns` talker turns and on transfer (HANDOFF); FINAL at end, with the org's summary keys | existing | async |

ally-be gains `src/helpline/service/helpline-copilot.service.ts`, which on each persisted talker
message runs, in parallel and off the socket path: keyword screen (sync) → `risk` call → `turn` call,
each emitting to the room as it lands. A failed or timed-out copilot call is silent to the listener
except for a small "copilot unavailable" dot; **it never delays message delivery**.

**Sparsity for nudges** (copied from supervisor notes): max 10 per chat, at least 2 talker turns
between nudges, ≤ 240 chars, never in the first turn. Suggestions have no cap but are skipped when the
listener is already typing (client sends `USER_TYPING`, server holds the emit for up to 4s, then emits
anyway so the suggestion isn't lost).

### 9.2 Registry rows (same PR as the code, CI enforces it)

| id | runtime | trigger | kind |
|---|---|---|---|
| `helpline-risk-screen` | ally-ai | "A talker sends a message on the text helpline" | completion |
| `helpline-copilot-turn` | ally-ai | "...and the listener's copilot drafts replies, a stage and an optional nudge" | completion |
| `helpline-rolling-summary` | ally-ai | "Every few talker turns, and on transfer" | completion |
| `helpline-final-summary` | ally-ai | "A text helpline chat ends" | completion |
| `helpline-qa-judge` | ally-be | "Within 30 min of a chat ending, the listener's messages are scored against the helping-skills rubric" | completion |

Plus `LLMTask` entries in `ally-ai/app/core/llm_usage/tasks.py` and `LlmTask` in
`ally-be/src/learn/enum/llm-task.enum.ts`.

### 9.3 Risk protocol, end to end

```
talker message persisted
  ├─ keyword rules (tenant + global, by language)      hit → HIGH immediately
  └─ POST /helpline/risk                               is_crisis & conf ≥ 0.70 → HIGH; is_crisis & conf < 0.70 → ELEVATED; failed → no flag, logged

HIGH   → RISK message to room (listener banner, persistent until acknowledged)
       → helpline_risk_flags row; chat.riskLevel = HIGH; queue priority 100 if still waiting
       → supervisors: in_app_notifications + FCM push + optional Slack; dedupe to one alert per chat per 10 min
       → emergencyResources[talker.language] sent to talker as SYSTEM once per chat (resourcesSentAt), labelled as from the service
       → AuditLoggerService HIPAA log: HELPLINE_RISK_FLAGGED with chatId, level, source (no body)
ELEVATED → banner only, no alert, no resources
Listener → Acknowledge / Mark false positive (outcome feeds a weekly calibration view in the monitor's QA tab)
```

The verbatim `signal` goes to the listener over the socket and to the HIPAA audit logger only; the
DB stores offsets. Thresholds live in org settings so a pilot can tune them without a deploy.

### 9.4 What the copilot must never do

- Write to the talker. Enforced in code: the gateway only accepts `SEND_MESSAGE` from sockets
  authenticated as listener/supervisor-with-takeover, and `SYSTEM` messages are drawn from org
  settings, not model output.
- Promise confidentiality, diagnose, or recommend medication. Prompt rules plus a post-generation
  check that drops a suggestion containing those patterns.
- Reward outcomes. QA scores feed feedback and supervision, never points, streaks or badges
  (gamification principle 2 in the retired product pages still binds here).

---

## 10. Supervision, QA, retention

- **Monitor** subscribes to `lobby-{tenant}` and joins `chat-{id}` rooms read-only.
- **Whisper**: `WHISPER` message type, persisted (so the listener can re-read), emitted to the
  listener's `user-{id}` room only. The transcript export for the talker's erasure request excludes
  whispers because they were never theirs.
- **Transfer**: listener or supervisor requests; the HANDOFF summary is generated; the target listener
  (or "next available") claims; talker gets a SYSTEM message naming the new listener; chat event
  `TRANSFERRED`. **Take over**: supervisor becomes the listener of record; the original listener is
  moved to read-only on that chat.
- **QA**: a scheduler job (`scheduledTaskRegistry`, 30-min bucket, same registration pattern as
  `foundational-skills-scheduler-registration.service.ts`) picks ended chats, builds a cut from the
  listener's messages only, runs the judge, writes `helpline_qa_scores`. Visible to supervisors and to
  the listener themselves (their own only), framed strengths → improvements → close.
- **Retention**: `helpline-retention.service.ts` modelled on the WhatsApp sweep: hourly, batches of
  500, blanks `messages.content` (and suggestion/whisper bodies), `helpline_talker_feedback.comment`,
  summaries' free text, and `helpline_talkers.displayName`; keeps counts, levels, scores, timings.
  Erasure request does the same immediately for one chat and revokes the token. Both logged at info
  with counts, never bodies.
- **Audit events** (add to `AUDIT_EVENTS`): `HELPLINE_SESSION_CREATED`, `HELPLINE_CHAT_CLAIMED`,
  `HELPLINE_RISK_FLAGGED`, `HELPLINE_RESOURCES_SENT`, `HELPLINE_CHAT_TRANSFERRED`,
  `HELPLINE_CHAT_ENDED`, `HELPLINE_TRANSCRIPT_ACCESSED`, `HELPLINE_ERASURE_REQUESTED`,
  `HELPLINE_TALKER_BLOCKED`.

---

## 11. WhatsApp channel (Phase 5)

Reuses the Meta provider, SQS inbound, signature verification, dedupe, consent and rate-limit steps of
`whatsapp-inbound.service.ts`. New branch at step 7 (identity): when the inbound `phone_number_id`
maps to a tenant with `whatsapp.enabled` in helpline settings, the sender is a **talker**, not a
worker: create/resume `helpline_talkers` (channel `TEXT_WHATSAPP`, `waContactId`), create the chat,
enqueue, and run the same risk layer. Listener replies go out through the provider; a `queued` row is
written before each send, as the invariant in that file demands.

Constraints to design around: Meta's 24-hour customer-service window (fine while the talker is
active; a listener reply after 24h of silence needs an approved template or is refused with a 4xx);
one Meta number per helpline org, or a shared number with a keyword to select the org; retention
blanking must also blank `wa_messages`. WhatsApp talkers are identified by phone, so the "fully
anonymous" promise on the consent copy differs for this channel.

---

## 12. Non-goals for v1 (state them now)

Voice or video; talker accounts or cross-device resume codes; an embeddable widget for partner
sites; AI that talks to the talker (including waiting-room bots); auto-assignment; group chats or
co-listening; a listener mobile app (ally-mobile follows once the web flow is stable); payments or
scheduling; translation of the chat between talker and listener languages (listeners are matched by
`languages` instead); CAPTCHA (hardening option, not v1).

---

## 13. Phases

Sizes are rough, for one engineer plus review. Phases 1–2 can start together.

| Phase | Deliverable | Repos | Size |
|---|---|---|---|
| **0. Decisions and copy** | Consent copy (legal-reviewed), talker terms + privacy page, AI-assistance disclosure wording, verified emergency numbers, default escalation checklist, listener training note. Run `/stacks:planning_context` on this doc. Decide pilot org(s). | docs | S |
| **1. Backend core** | Migrations (§3) + `LISTENER`/`HELPLINE_SUPERVISOR` groups; guest JWT + public endpoints (§4); `/helpline-chat` gateway with dual auth; Redis adapter; presence; queue + atomic claim; lifecycle timers (§5); tenant gate; rate limits; audit events; `DATA_SCHEMA.md` | ally-be | L |
| **2. Talker page + listener workspace (no copilot)** | §7.1 and §7.2 minus the copilot panel; `useCanUseTextHelpline`; nav tab; chat logs channel filter; `LISTENER` in `ALLOWED_ROLES`; admin org toggle + settings form; i18n keys; PostHog events | ally-web (+ ally-mobile allow-list) | L |
| **3. Copilot** | ally-ai `helpline/risk`, `helpline/turn`, prompts, `LLMTask` rows; ally-be copilot service, keyword layer, risk protocol (§9.3), supervisor alerts, auto-resources; rolling/final summary; copilot panel UI; registry rows; prompt sync | ally-ai, ally-be, ally-web | L |
| **4. Supervision, QA, retention** | Monitor, whisper, transfer/take-over; QA judge job + QA tab; retention sweep + erasure; wellbeing interstitial | ally-be, ally-web | M |
| **5. WhatsApp channel** | §11 | ally-be, ally-web (channel badge, phone-number settings) | M |
| **6. Hardening and pilot** | Two-socket e2e suite; replica-failover test; load test (500 concurrent chats); accessibility pass on talker page; Turnstile if abuse shows; wiki page + `.docs-map.yml`; pilot with one org, weekly calibration review of risk flags | all | M |

**Thin vertical slice to ship first** (end of Phase 2): one org, web talkers, queue + claim, plain chat,
summary at end, retention. That is already a usable helpline. Copilot lands on top without changing the
schema.

---

## 14. Testing

- **ally-be unit:** claim atomicity under concurrent claims; keyword → classifier layering and
  thresholds; sparsity rules; retention blanking idempotence; guest token scope (a guest socket cannot
  join another `chat-{id}`); whisper never reaches a talker socket; tenant isolation on every
  repository query. Specs in `test/` folders next to code, as `TESTING.md` requires.
- **ally-be e2e:** two socket clients (guest + listener) through the full lifecycle, including
  reconnect resync and idle end, against the Docker stack (`./test-docker.sh e2e`).
- **ally-ai:** pytest fixtures for the risk prompt in en/hi/Hinglish/ta/kn, including indirect
  phrasing and the "my friend is…" case; structured-output schema tests for `/helpline/turn`.
- **ally-web:** Vitest for the consent → waiting → chat state machine, suggestion insert (never send),
  banner persistence until acknowledged, gating hook. Run the helpline *and* admin suites; nothing in
  `ui-shared` should need to change, which keeps the third suite out of scope.
- **Guards CI already runs:** registry row per LLM call; `DATA_SCHEMA.md` per entity change; PostHog
  list per event; locale test for blank translations.

---

## 15. Open questions and risks

1. **AI-assistance disclosure to talkers.** This plan discloses it on the consent screen. If product
   or legal prefer not to, the copy changes but nothing else does. Decide in Phase 0.
2. **Minors and mandatory reporting.** The consent screen should state an age floor or the org's
   policy; the escalation checklist needs the org's reporting procedure. Org setting, not code.
3. **Listener identity shown to talkers.** Display name only (first name or a chosen alias), never the
   account email. Confirm with the pilot org.
4. **Emergency numbers** in §8 need verification before seeding.
5. **Socket scaling** depends on the Redis adapter landing first; without it the feature only works
   on a single replica.
6. **False positives** on the auto-sent resources message are the main UX risk of decision 5; the
   0.70 threshold and the once-per-chat cap are the mitigations, and the calibration view exists to
   tune them during the pilot.
7. **Listener load and wellbeing.** Default `maxConcurrentChats` of 2 is deliberate; raising the org
   cap should be a conscious decision by the org admin.
8. **Meta template approval** lead time for the WhatsApp first-response and after-24h templates can
   be weeks; start it when Phase 5 is scheduled, not when it starts.
