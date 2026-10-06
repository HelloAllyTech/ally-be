# Text helpline — build contract

**Status:** v1 build, 2026-10-05. Source plan: `text-helpline-copilot-plan.md` (2026-10-04, product
decisions §0 of that plan are binding). This file is the **contract** the three repos build against:
ally-be (server), ally-web (`ally-helpline-dashboard` talker page + listener workspace,
`ally-admin-dashboard` org settings), ally-ai (copilot endpoints). If code and this file disagree,
fix one of them in the same PR.

Product invariants (never trade these away):

1. **Humans only write to talkers.** No model output is ever delivered to a talker socket or a
   talker-visible message. The only automated talker-visible text is org-authored (emergency
   resources, closing message) or fixed UI copy rendered client-side from a `systemKind`.
2. **Whispers, suggestions, nudges, stages, risk flags are staff-only.** Enforced by the
   `visible_to_talker` column + a DB CHECK (`type IN ('TEXT','SYSTEM') OR visible_to_talker = false`)
   + separate socket rooms (`talker:{chatId}` vs `staff:{chatId}`).
3. **A copilot failure never delays message delivery.** Persist + emit first, copilot after, off the
   request path, with hard timeouts.
4. **Fail closed on the gate.** Every listener route and the socket handshake require the permission
   **and** `TEXT_HELPLINE_ENABLED` for the caller's tenant.
5. **No message bodies in logs, audit payloads, chat events, PostHog or notifications.** The
   classifier's verbatim `signal` goes to the listener over the socket and to the HIPAA audit logger
   only; the DB stores offsets.

---

## 1. Deviations from the plan (and why)

| Plan said | Built | Why |
|---|---|---|
| Reuse `chats` / `messages` / `queue_entries` | **New tables** `helpline_chats`, `helpline_messages`; the queue is `helpline_chats.status = 'WAITING'` | `chats` is read raw by Scribe analytics (`scribe-analytics.repository.ts`, `scribe-adoption-analytics.repository.ts`) and the call-log/custom-field services. Text chats in `chats` would silently inflate Scribe adoption metrics and surface in Scribe call logs. A one-table queue makes the atomic claim a single `UPDATE … WHERE status='WAITING'`. |
| `@socket.io/redis-adapter` on the Nest IO adapter for all namespaces | **`MessageBrokerService` fan-out** for the `/helpline-chat` namespace only | Existing gateways already fan out across replicas via the broker and then emit to *local* rooms; a global Redis adapter would make every one of those local emits cluster-wide → N× duplicate delivery on the microphone/telephony gateways. The broker pattern is the codebase's established one and needs no new dependency. |
| Org admin grants LISTENER from "Org Settings → access management" | **Helpline → Team** tab (tenant ADMIN, `edit:helpline:team`) | The consumer Org. Settings mirror was removed 2026-09-30. Team is scoped to granting/revoking exactly two groups in the caller's tenant. |
| Tenant ADMIN gets `edit:helpline:settings` | Settings (incl. emergency text) are edited by **platform admins** in the admin console, `EDIT_GLOBAL_SETTINGS` | Matches the post-2026-09-30 rule that per-tenant settings live only in the admin console. |
| KIRAN 1800-599-0019 in default resources | **Dropped** | Verified 2026-10-05: KIRAN was merged into Tele-MANAS and phased out. Defaults: Tele-MANAS **14416** / **1-800-891-4416** (24×7, free), emergency **112**. |
| ally-mobile `ALLOWED_ROLES` gets LISTENER | **Not changed** | v1 has no listener mobile surface (plan §12 non-goal); a LISTENER-only account has nothing to do in the app. Revisit with the mobile listener work. |

---

## 2. Roles and permissions (ally-be `permissions.constants.ts` + migration)

```ts
VIEW_HELPLINE_LOBBY:    'view:helpline:lobby'
EDIT_HELPLINE_PRESENCE: 'edit:helpline:presence'
EDIT_HELPLINE_CLAIM:    'edit:helpline:claim'
VIEW_HELPLINE_CHAT:     'view:helpline:chat'
EDIT_HELPLINE_MESSAGE:  'edit:helpline:message'
EDIT_HELPLINE_END:      'edit:helpline:end'
VIEW_HELPLINE_COPILOT:  'view:helpline:copilot'
EDIT_HELPLINE_SUMMARY:  'edit:helpline:summary'
VIEW_HELPLINE_MONITOR:  'view:helpline:monitor'
EDIT_HELPLINE_WHISPER:  'edit:helpline:whisper'
EDIT_HELPLINE_TRANSFER: 'edit:helpline:transfer'
VIEW_HELPLINE_QA:       'view:helpline:qa'
EDIT_HELPLINE_TEAM:     'edit:helpline:team'
```

| Group | Permissions |
|---|---|
| `LISTENER` (new) | the first 8 above |
| `HELPLINE_SUPERVISOR` (new) | LISTENER + `view:helpline:monitor`, `edit:helpline:whisper`, `edit:helpline:transfer`, `view:helpline:qa` |
| `ADMIN` (existing, tenant) | HELPLINE_SUPERVISOR set + `edit:helpline:team` |

`UserRole` gains `LISTENER`, `HELPLINE_SUPERVISOR` (ally-be enum + helpline app enum + helpline
`ALLOWED_ROLES`). Migration writes `permissions`, `groups`, `group_permissions` idempotently
(`NOT EXISTS` style of `1968000000000-CreateEvaluatorRole.ts`). The 30-min permission cache means
ADMIN's new grants lag up to 30 min after deploy.

Every listener HTTP route: `@AuthPermissions([...])` **plus** `@RequireHelplineEnabled()` (new guard,
reads `TenantFeatureService.isEnabledForTenant(PreferenceName.TEXT_HELPLINE_ENABLED, user.tenantId)`,
fails closed, `errorCode: HELPLINE_DISABLED`, 403).

---

## 3. Tenancy

Helpline rows store the tenant **uuid** (`tenants.id`) in `tenant_id`. `HelplineTenantService`
normalises any identifier (uuid or code, as JWTs carry either) → `{ id, code, name, logoUrl }`,
cached in memory 5 min. Preferences are keyed by tenant **code** (existing convention). Every
repository query filters on `tenant_id`; guest queries additionally on `talker_id` + `chat_id` from
the token.

---

## 4. Data model (ally-be `src/helpline/entity/`)

All tables have `tenant_id varchar NOT NULL` (except keyword rules, nullable = global), `created_at`,
`updated_at`. uuid PKs unless noted. Enum columns get CHECK constraints (the
`check-constraints-cover-enums.spec.ts` guard requires it).

**`helpline_talkers`** — `id`, `channel` (`TEXT_WEB`|`TEXT_WHATSAPP`), `display_name varchar(40)`,
`language varchar(8)`, `consent_version varchar(32)`, `consent_accepted_at`, `ip_hash varchar(64) null`
(sha-256 of ip + server salt; abuse windows only), `user_agent varchar(255) null`, `last_seen_at`,
`revoked_at null` (token revoked: erasure/block), `blocked_at null`, `blocked_by int null`,
`erased_at null`, `wa_contact_id uuid null` (Phase 5).

**`helpline_chats`** — `id`, `talker_id`, `channel`, `status` (`WAITING`|`ACTIVE`|`ENDED`),
`language`, `priority int default 0` (100 on HIGH risk), `wait_started_at`, `abandoned_at null`
(talker gone while WAITING; hidden from lobby, revivable 10 min), `claimed_at`, `listener_id int null`,
`previous_listener_ids int[] default '{}'` (read-only access after transfer/take-over),
`transfer_requested_at null`, `transfer_requested_by int null`, `transfer_target_listener_id int null`,
`taken_over_at null`, `ended_at`, `ended_reason` (see below), `ended_by int null`,
`risk_level` (`NONE`|`ELEVATED`|`HIGH`, denormalised max), `resources_sent_at null`,
`last_talker_message_at`, `last_listener_message_at`, `talker_message_count int`,
`listener_message_count int`, `talker_turns_since_nudge int default 0`, `nudge_count int default 0`,
`qa_status null` (`PENDING`|`DONE`|`SKIPPED`|`FAILED`), `erased_at null`, `metadata jsonb null`.
Indexes: `(tenant_id, status, priority desc, wait_started_at)`, `(tenant_id, listener_id, status)`,
`(talker_id)`.

`ended_reason`: `LISTENER_ENDED`, `TALKER_ENDED`, `TALKER_LEFT_QUEUE`, `TALKER_DISCONNECTED`,
`WAIT_EXPIRED`, `QUEUE_ABANDONED`, `SUPERVISOR_ENDED`, `TALKER_ERASED`, `TALKER_BLOCKED`.

**`helpline_messages`** — `id int` (generated, monotonic → `afterId` resync), `chat_id uuid`,
`sender_role` (`TALKER`|`LISTENER`|`SUPERVISOR`|`SYSTEM`|`COPILOT`), `sender_user_id int null`,
`type` (`TEXT`|`SYSTEM`|`SUGGESTION`|`NUDGE`|`STAGE`|`RISK`|`WHISPER`|`TRANSFER`),
`system_kind varchar(40) null`, `content text`, `parent_message_id int null`,
`client_message_id uuid null` (unique per chat where not null → idempotent resend),
`visible_to_talker bool`, `metadata jsonb null`, `erased_at null`.
CHECK: `type IN ('TEXT','SYSTEM') OR visible_to_talker = false`.
Index `(chat_id, id)`.

**`helpline_listener_profiles`** — `user_id int` (unique), `display_name varchar(40)` (alias shown
to talkers; defaults to first name), `max_concurrent_chats int default 2` (≤ org cap),
`languages text[] default '{}'`, `notifications_enabled bool default true`.

**`helpline_risk_flags`** — `chat_id`, `message_id int`, `level` (`ELEVATED`|`HIGH`), `source`
(`KEYWORD`|`CLASSIFIER`), `confidence real null`, `subject` (`SELF`|`OTHER`|`UNCLEAR`) null,
`rule_id uuid null`, `signal_start int null`, `signal_end int null` (**offsets into the message
body**, never the text), `resources_sent bool default false`, `acknowledged_by int null`,
`acknowledged_at null`, `outcome` (`UNREVIEWED`|`CONFIRMED`|`FALSE_POSITIVE`) default `UNREVIEWED`,
`outcome_note varchar(500) null` (blanked by retention).

**`helpline_risk_keyword_rules`** — `tenant_id null` (NULL = platform default), `phrase`,
`language`, `match_type` (`CONTAINS`|`WORD`), `level` (`ELEVATED`|`HIGH`), `enabled bool`.
Seeded with platform defaults (en, hi Devanagari + romanised, mr, ta, kn). Matching normalises
case, whitespace and Unicode (NFKC — a superset of NFC that also folds full-width forms and composes
decomposed Tamil/Kannada vowel signs; keep `\p{M}` marks — Indic vowel signs are Marks; drop the
Devanagari nukta and ZWJ/ZWNJ so "ख़ुदकुशी" and "खुदकुशी" are one rule). A hit's offsets are mapped
back to the original body; when normalisation changed a word's length the offsets cover the whole word.

**`helpline_chat_events`** — `chat_id`, `type` (`ENQUEUED`, `CLAIMED`, `TALKER_DISCONNECTED`,
`TALKER_RECONNECTED`, `LISTENER_DISCONNECTED`, `LISTENER_RECONNECTED`, `TRANSFER_REQUESTED`,
`TRANSFERRED`, `ASSIGNED`, `TAKEN_OVER`, `RESOURCES_SENT`, `RISK_FLAGGED`, `RISK_ACKNOWLEDGED`,
`SUPERVISOR_ALERTED`, `ENDED`, `ERASURE_REQUESTED`, `TALKER_BLOCKED`), `actor_user_id int null`,
`payload jsonb null` (**no message bodies**).

**`helpline_chat_summaries`** — `chat_id`, `kind` (`ROLLING`|`HANDOFF`|`FINAL`),
`fields jsonb` (`{ [key]: string }`), `through_message_id int`, `edited_by int null`,
`version int default 1`. One row per (chat, kind) updated in place (version++).

**`helpline_qa_scores`** — `chat_id` (unique), `listener_id int`, `rubric_version`,
`levels jsonb` (`{ skillKey: 1..4 }`), `verdicts jsonb` (judge output incl. ticked behaviours and
evidence line ids), `composite_score real`, `has_unhelpful_behaviour bool`, `judge_model`.

**`helpline_talker_feedback`** — `chat_id` (unique), `rating smallint` 1–5,
`comment varchar(1000) null` (blanked by retention).

Org settings live in Preference rows (no table): `TEXT_HELPLINE_ENABLED` (`{enabled}`) and
`TEXT_HELPLINE_SETTINGS` (jsonb, §8). Presence lives in Redis (§6.4).

`DATA_SCHEMA.md` gets a "Text helpline" domain section.

---

## 5. HTTP API (ally-be, global prefix `/api`)

Errors use the existing filter body `{ statusCode, message, error, errorCode? }`. New `ErrorCode`
values: `HELPLINE_DISABLED`, `HELPLINE_CLOSED`, `HELPLINE_QUEUE_FULL`, `HELPLINE_CONSENT_OUTDATED`,
`HELPLINE_TALKER_BLOCKED`, `HELPLINE_CHAT_NOT_FOUND`, `HELPLINE_ALREADY_CLAIMED`,
`HELPLINE_AT_CAPACITY`, `HELPLINE_NOT_AVAILABLE`, `HELPLINE_CHAT_ENDED`, `HELPLINE_NOT_LISTENER`,
`HELPLINE_GUEST_TOKEN_INVALID`.

### 5.1 Public (no auth) — `HelplinePublicController`

`GET /v1/helpline/public/:tenantCode/status?lang=en` (cached 10 s per tenant)
```ts
type PublicStatusDto =
  | { enabled: false }                                   // unknown code OR disabled (no leak)
  | {
      enabled: true;
      open: boolean;
      closedReason: 'NO_LISTENERS' | 'OUTSIDE_HOURS' | 'QUEUE_FULL' | null;
      org: { name: string; logoUrl: string | null };
      languages: string[];                               // offered to talkers
      hours: HelplineHours | null;
      estimatedWaitMinutes: number | null;               // median of last 20 claimed waits; null if < 5 samples
      resources: Record<string, string>;                 // emergencyResources by language
      consent: { version: string; retentionDays: number; ageNotice: string | null };
    };
```
`open = enabled && withinHours && availableListeners ≥ 1 && waiting < maxWaitingTalkers`
(or `allowQueueWhenNoListeners` lifts the listener condition).

`POST /v1/helpline/public/:tenantCode/session` — `@RateLimit({ key: 'ip', limit: 5, ttl: 3_600_000 })`
```ts
body: { displayName?: string /* ≤40, default "Anonymous" */; language: string; consentVersion: string; firstMessage?: string /* ≤2000 */ }
201:  { guestToken: string; expiresAt: string; chat: GuestChatDto; messages: GuestMessageDto[] }
errors: 403 HELPLINE_DISABLED · 409 HELPLINE_CLOSED · 503 HELPLINE_QUEUE_FULL · 400 HELPLINE_CONSENT_OUTDATED · 403 HELPLINE_TALKER_BLOCKED
```
Creates talker + chat(WAITING) + `ENQUEUED` event, risk-screens `firstMessage` if present, emits
`QUEUE_UPDATED`. No row exists before consent is accepted. A `language` the org does not offer falls
back to `en` (or the first offered language) rather than refusing; a `firstMessage` over 2,000 chars
is a 400.

### 5.2 Guest (guest JWT, `Authorization: Bearer <guestToken>`) — `HelplineGuestController`

| Route | Body | Returns |
|---|---|---|
| `GET /v1/helpline/guest/chat?afterId=` | — | `{ chat: GuestChatDto; messages: GuestMessageDto[] }` |
| `POST /v1/helpline/guest/refresh` | — | `{ guestToken, expiresAt }` (allowed until 24 h after end) |
| `POST /v1/helpline/guest/end` | — | `{ chat }` (WAITING → `TALKER_LEFT_QUEUE`, ACTIVE → `TALKER_ENDED`) |
| `POST /v1/helpline/guest/erase` | — | `204`; blanks bodies now, ends chat if open, revokes token |
| `POST /v1/helpline/guest/feedback` | `{ rating: 1..5; comment?: string }` | `204` (once per chat; a repeat also answers `204` and keeps the first) |

Guest token: HS256, secret `HELPLINE_GUEST_JWT_SECRET` or, if unset, `HMAC-SHA256(accessTokenSecret,
'helpline-guest-v1')` — **never** the user access secret itself, so `JwtStrategy` cannot accept it.
`aud: 'helpline-guest'`, `sub: talkerId`, claims `{ typ: 'helpline_guest', cid: chatId, tid: tenantUuid, ch: 'TEXT_WEB' }`,
TTL 24 h. Every guest request and socket handshake re-checks `helpline_talkers.revoked_at IS NULL`.

```ts
interface GuestChatDto {
  id: string;
  status: 'WAITING' | 'ACTIVE' | 'ENDED';
  endedReason: string | null;
  language: string;
  displayName: string;
  listenerName: string | null;          // alias only, never email/full name
  queuePosition: number | null;         // 1-based while WAITING
  waitStartedAt: string;
  claimedAt: string | null;
  endedAt: string | null;
  feedbackSubmitted: boolean;
  org: { name: string; logoUrl: string | null };
}
interface GuestMessageDto {
  id: number;
  clientMessageId: string | null;
  from: 'ME' | 'LISTENER' | 'SERVICE';
  type: 'TEXT' | 'SYSTEM';
  systemKind: GuestSystemKind | null;
  content: string;                      // RESOURCES/CLOSING: org text; other kinds: English fallback, client localises by systemKind
  params?: Record<string, string>;      // e.g. { listenerName }
  createdAt: string;
}
type GuestSystemKind = 'ACCEPTED' | 'RESOURCES' | 'CLOSING' | 'TRANSFERRING' | 'LISTENER_RECONNECTING' | 'LISTENER_BACK' | 'ENDED';
// A listener/supervisor end writes CLOSING (the org's closingMessage in the talker's language, en fallback);
// every other end except erasure writes ENDED with params.endedReason.
```

### 5.3 Listener / supervisor (user JWT) — `HelplineController`

All require `@RequireHelplineEnabled()`. Permission per row.

| Route | Permission | Body / query | Returns |
|---|---|---|---|
| `GET /v1/helpline/enabled` | authenticated only | — | `{ enabled: boolean }` (for the nav gate; no helpline permission needed, no 403) |
| `GET /v1/helpline/me` | `view:helpline:lobby` | — | `MeDto` |
| `PUT /v1/helpline/me/profile` | `edit:helpline:presence` | `{ displayName?, maxConcurrentChats?, languages?, notificationsEnabled? }` | `MeDto` |
| `PUT /v1/helpline/me/presence` | `edit:helpline:presence` | `{ status: 'AVAILABLE' \| 'AWAY' }` | `MeDto` |
| `GET /v1/helpline/lobby` | `view:helpline:lobby` | — | `LobbyDto` |
| `POST /v1/helpline/chats/:id/claim` | `edit:helpline:claim` | — | `ChatDetailDto` · 409 `HELPLINE_ALREADY_CLAIMED` · 409 `HELPLINE_AT_CAPACITY` · 409 `HELPLINE_NOT_AVAILABLE` |
| `GET /v1/helpline/chats/:id` | `view:helpline:chat` | — | `ChatDetailDto` (audited `HELPLINE_TRANSCRIPT_ACCESSED` when ENDED) |
| `GET /v1/helpline/chats/:id/messages?afterId=` | `view:helpline:chat` | — | `{ messages: StaffMessageDto[] }` |
| `POST /v1/helpline/chats/:id/end` | `edit:helpline:end` | — | `ChatDetailDto` |
| `PUT /v1/helpline/chats/:id/summary` | `edit:helpline:summary` | `{ fields: Record<string,string> }` | `SummaryDto` (FINAL, `editedBy`) |
| `GET /v1/helpline/chats?scope=mine\|all&status=ENDED&page=1&limit=25` | `view:helpline:chat` (`all` needs `view:helpline:monitor`) | — | `{ items: ChatListItemDto[]; total }` |
| `POST /v1/helpline/chats/:id/risk-flags/:flagId/ack` | `view:helpline:copilot` | `{ outcome: 'CONFIRMED' \| 'FALSE_POSITIVE'; note?: string }` | `RiskFlagDto` |
| `POST /v1/helpline/chats/:id/copilot-feedback` | `view:helpline:copilot` | `{ messageId: number; index?: number; rating: 'UP' \| 'DOWN' }` | `204` |
| `POST /v1/helpline/chats/:id/transfer` | `edit:helpline:transfer` **or** listener of record with `edit:helpline:end` | `{ targetListenerId?: number }` | `ChatDetailDto` |
| `POST /v1/helpline/chats/:id/assign` | `edit:helpline:transfer` | `{ listenerId: number }` | `ChatDetailDto` (WAITING or transfer-pending → that listener) |
| `POST /v1/helpline/chats/:id/take-over` | `edit:helpline:transfer` | — | `ChatDetailDto` |
| `POST /v1/helpline/chats/:id/whisper` | `edit:helpline:whisper` | `{ content: string }` | `StaffMessageDto` |
| `POST /v1/helpline/talkers/:talkerId/block` | `edit:helpline:transfer` | `{ reason?: string }` | `204` (ends chat `TALKER_BLOCKED`) |
| `GET /v1/helpline/monitor` | `view:helpline:monitor` | — | `MonitorDto` |
| `GET /v1/helpline/risk-flags?outcome=&days=7` | `view:helpline:monitor` | — | `{ items: RiskFlagRowDto[]; counts: { UNREVIEWED; CONFIRMED; FALSE_POSITIVE }; bySource: {...} }` (calibration view) |
| `GET /v1/helpline/qa?listenerId=&page=` | `view:helpline:qa` | — | `{ items: QaListItemDto[]; total }` |
| `GET /v1/helpline/qa/mine` | `view:helpline:lobby` | — | `{ items: QaListItemDto[] }` (own only) |
| `GET /v1/helpline/qa/:chatId` | own, or `view:helpline:qa` | — | `QaDetailDto` |
| `GET /v1/helpline/team?search=` | `edit:helpline:team` | `search?` (name/email contains; additive) | `{ items: TeamMemberDto[] }` (ACTIVE users of caller's tenant, helpline members first, ≤ 1000; Ally platform staff are never listed or editable) |
| `PUT /v1/helpline/team/:userId` | `edit:helpline:team` | `{ listener: boolean; supervisor: boolean }` | `TeamMemberDto` (only these two groups; busts permission cache) |

### 5.4 Admin console (platform admin) — `HelplineAdminController`

| Route | Permission | Body | Returns |
|---|---|---|---|
| `GET /v1/helpline/admin/settings?tenantId=` | `EDIT_GLOBAL_SETTINGS` | — | `AdminSettingsDto` |
| `PUT /v1/helpline/admin/settings` | `EDIT_GLOBAL_SETTINGS` | `{ tenantId: string; enabled?: boolean; settings?: Partial<HelplineSettings> }` | `AdminSettingsDto` |

```ts
interface AdminSettingsDto { tenantId: string; tenantCode: string; enabled: boolean; settings: HelplineSettings; defaults: HelplineSettings; publicPath: string /* "/talk/<code>" */ }
```
Turning `enabled` off refuses new sessions; open chats are not force-ended. Invariant 4 still holds:
listener HTTP routes and new staff socket handshakes answer `HELPLINE_DISABLED` from that moment, so
an open chat continues over already-connected sockets and then ends through the talker or the
lifecycle sweep (idle / wait limits). Re-enabling restores the listener routes.

### 5.5 Staff DTOs

```ts
type Presence = 'AVAILABLE' | 'AWAY' | 'OFFLINE';
interface MeDto {
  userId: number;
  profile: { displayName: string; maxConcurrentChats: number; languages: string[]; notificationsEnabled: boolean };
  presence: Presence;
  activeChatCount: number;
  orgMaxConcurrentPerListener: number;
  settings: ListenerSettingsDto;
}
interface ListenerSettingsDto {
  escalationChecklist: string[];
  listenerSupportContact: string | null;
  summaryFields: { key: string; label: string; description: string }[];
  copilot: { suggestions: boolean; nudges: boolean; riskClassifier: boolean };
  languages: string[];
  idleEndMinutes: number;
}
interface LobbyEntryDto {
  chatId: string;
  kind: 'NEW' | 'TRANSFER';
  displayName: string;
  language: string;
  waitStartedAt: string;
  priority: number;
  riskLevel: 'NONE' | 'ELEVATED' | 'HIGH';
  preview: string | null;          // first talker message, ≤140 chars
  transferFromName: string | null;
  targetListenerId: number | null; // transfer/assign aimed at one listener
}
interface LobbyDto {
  waiting: LobbyEntryDto[];        // priority desc, then waitStartedAt asc; excludes abandoned
  myChats: ChatListItemDto[];      // my ACTIVE chats
  counts: { waiting: number; active: number; listenersAvailable: number };
}
interface ChatListItemDto {
  id: string; status: 'WAITING' | 'ACTIVE' | 'ENDED';
  talkerName: string; language: string;
  listener: { id: number; displayName: string } | null;
  riskLevel: 'NONE' | 'ELEVATED' | 'HIGH';
  waitStartedAt: string; claimedAt: string | null; endedAt: string | null; endedReason: string | null;
  lastMessageAt: string | null; unreadForMe?: number;
  messageCount: number;
  erased: boolean;
}
interface ChatDetailDto {
  chat: StaffChatDto;
  messages: StaffMessageDto[];     // all types incl. staff-only
  riskFlags: RiskFlagDto[];
  summaries: { rolling: SummaryDto | null; handoff: SummaryDto | null; final: SummaryDto | null };
  copilot: { status: 'OK' | 'UNAVAILABLE' | 'OFF'; stage: string | null };
  events: { type: string; at: string; actorName: string | null }[];   // timeline, no bodies
}
interface StaffChatDto {
  id: string; status: 'WAITING' | 'ACTIVE' | 'ENDED'; channel: 'TEXT_WEB' | 'TEXT_WHATSAPP';
  talker: { id: string; displayName: string; language: string; consentVersion: string; connected: boolean; blocked: boolean };
  listener: { id: number; displayName: string } | null;
  myAccess: 'LISTENER' | 'READ_ONLY';
  priority: number; riskLevel: 'NONE' | 'ELEVATED' | 'HIGH';
  waitStartedAt: string; claimedAt: string | null; endedAt: string | null; endedReason: string | null;
  lastTalkerMessageAt: string | null; lastListenerMessageAt: string | null;
  transferPending: boolean; resourcesSentAt: string | null;
  listenerConnected: boolean;
  erased: boolean;
}
interface StaffMessageDto {
  id: number; chatId: string; clientMessageId: string | null;
  type: 'TEXT' | 'SYSTEM' | 'SUGGESTION' | 'NUDGE' | 'STAGE' | 'RISK' | 'WHISPER' | 'TRANSFER';
  senderRole: 'TALKER' | 'LISTENER' | 'SUPERVISOR' | 'SYSTEM' | 'COPILOT';
  senderUserId: number | null; senderName: string | null;
  systemKind: string | null;        // talker kinds + staff-only: TALKER_DISCONNECTED, TALKER_RECONNECTED, TAKEN_OVER, TRANSFERRED, ASSIGNED
  content: string;
  parentMessageId: number | null;
  visibleToTalker: boolean;
  metadata: Record<string, unknown> | null;
  // SUGGESTION: { suggestions: { index: number; text: string; skillKey: string }[]; accepted?: number[]; feedback?: Record<number,'UP'|'DOWN'> }
  // NUDGE: { skillKey?: string; feedback?: 'UP'|'DOWN' }   STAGE: { stage: string }
  // RISK: { flagId: string; level; source; confidence; subject }
  // TEXT from listener: { fromSuggestion?: { messageId: number; index: number; editedDistance: number } }
  createdAt: string; erased: boolean;
}
interface RiskFlagDto {
  id: string; messageId: number; level: 'ELEVATED' | 'HIGH'; source: 'KEYWORD' | 'CLASSIFIER';
  confidence: number | null; subject: 'SELF' | 'OTHER' | 'UNCLEAR' | null;
  signal: string | null;            // re-derived from offsets on the live message body; null once erased
  resourcesSent: boolean;
  acknowledgedAt: string | null; acknowledgedByName: string | null;
  outcome: 'UNREVIEWED' | 'CONFIRMED' | 'FALSE_POSITIVE'; outcomeNote: string | null;
  createdAt: string;
}
interface SummaryDto { kind: 'ROLLING' | 'HANDOFF' | 'FINAL'; fields: Record<string, string>; throughMessageId: number; editedByName: string | null; version: number; updatedAt: string }
interface MonitorDto {
  tiles: { waiting: number; active: number; listenersAvailable: number; openHighFlags: number };
  activeChats: (ChatListItemDto & { lastMessageAgeSeconds: number | null; listenerConnected: boolean; talkerConnected: boolean; transferPending: boolean; openFlags: number })[];
  waiting: LobbyEntryDto[];
  listeners: { userId: number; displayName: string; presence: Presence; activeChatCount: number; maxConcurrentChats: number; languages: string[] }[];
}
interface QaListItemDto { chatId: string; listenerId: number; listenerName: string; endedAt: string; compositeScore: number; hasUnhelpfulBehaviour: boolean; rubricVersion: string }
interface QaDetailDto extends QaListItemDto {
  skills: { key: string; label: string; tier: 'Engage' | 'Understand' | 'Support'; level: 1 | 2 | 3 | 4;
            unhelpful: string[]; basicMet: string[]; basicMissing: string[]; advanced: string[]; evidence: { messageId: number; quote: string }[] }[];
}
interface TeamMemberDto { userId: number; name: string; email: string; isListener: boolean; isSupervisor: boolean; isAdmin: boolean }
```

---

## 6. Real-time — namespace `/helpline-chat`

### 6.1 Handshake
`handshake.auth.token` = guest token **or** user access token.
- Guest: verify with the guest secret + `aud`; talker not revoked; chat exists → `socket.data = { kind: 'talker', talkerId, chatId, tenantId }`; joins `talker:{chatId}` **only**.
- User: existing user-JWT verification; requires `view:helpline:lobby` **or** `view:helpline:monitor`, and the tenant gate → `socket.data = { kind: 'staff', userId, tenantId, permissions }`; joins `user:{userId}`, `lobby:{tenantId}` (lobby perm), `supervisors:{tenantId}` (monitor perm), and `staff:{chatId}` for every ACTIVE chat where they are listener of record.
- Failure → `next(new Error('unauthorized'))`.

### 6.2 Cross-replica emit
`HelplineRealtimeService.emit(room, event, payload)` publishes `{ room, event, payload }` on broker
channel `HELPLINE_SOCKET_EMIT`; every replica's gateway subscriber does
`namespace.to(room).emit(event, payload)` to its **local** sockets. Nothing emits directly.
Typing events use the same path. Staff and talker payloads are built separately
(`toGuestMessageDto` / `toStaffMessageDto`) — the talker room only ever receives guest DTOs of
`visible_to_talker` rows.

### 6.3 Events

Client → server (all acks are `{ ok: true, ... } | { ok: false, error: string }`):

| Event | Who | Payload | Ack |
|---|---|---|---|
| `SEND_MESSAGE` | talker; listener of record; supervisor after take-over | `{ chatId, clientMessageId, content, suggestion?: { messageId, index } }` | `{ ok, message }` (guest or staff DTO). Errors: `rate_limited`, `too_long`, `empty`, `chat_ended`, `not_allowed`, plus `invalid` (clientMessageId not a uuid) and `not_found` (staff: no access) |
| `USER_TYPING` / `USER_STOPPED_TYPING` | talker, listener | `{ chatId }` | — (client throttles to 1 per 2 s; never persisted) |
| `SYNC_SINCE` | both | `{ chatId, afterId }` | `{ ok, messages }` |
| `JOIN_CHAT` | staff | `{ chatId }` | `{ ok, access: 'LISTENER' \| 'READ_ONLY' }` (monitoring supervisor or previous listener) |
| `LEAVE_CHAT` | staff | `{ chatId }` | `{ ok }` |
| `PRESENCE_SET` | staff | `{ status: 'AVAILABLE' \| 'AWAY' }` | `{ ok, presence }` |
| `HEARTBEAT` | both, every 15 s | `{}` | `{ ok }` |

Rate limit (per socket, in memory): 1 msg/s sustained, burst 5; content ≤ 2,000 chars after trim.
Any handler error acks `{ ok: false, error: 'internal_error' }` (never a crash). A resend with a known
`clientMessageId` acks the stored message and emits nothing.

Server → client:

| Event | Room | Payload |
|---|---|---|
| `MESSAGE_RECEIVED` | talker / staff | `{ chatId, message }` (guest / staff DTO) |
| `USER_TYPING`, `USER_STOPPED_TYPING` | the other side | `{ chatId, role: 'TALKER' \| 'LISTENER' }` |
| `QUEUE_POSITION` | talker | `{ chatId, position }` |
| `CHAT_ACCEPTED` | talker | `{ chat: GuestChatDto }` |
| `CHAT_UPDATED` | talker (guest DTO) / staff (`StaffChatDto`) | `{ chat }` — `myAccess` is per viewer: the listener of record gets `LISTENER` on `user:{id}`, the rest of `staff:{chatId}` gets `READ_ONLY` |
| `CHAT_ENDED` | both | `{ chatId, endedReason }` |
| `QUEUE_UPDATED` | lobby | `{ waiting: LobbyEntryDto[]; counts }` |
| `PRESENCE_UPDATED` | user | `{ presence, activeChatCount }` |
| `PARTICIPANT_STATUS` | staff | `{ chatId, role: 'TALKER' \| 'LISTENER', connected: boolean }` |
| `RISK_FLAGGED` | staff | `{ chatId, flag: RiskFlagDto }` (carries live `signal`) |
| `SUGGESTIONS` | staff | `{ chatId, message: StaffMessageDto }` (type SUGGESTION) |
| `NUDGE` | staff | `{ chatId, message }` |
| `STAGE` | staff | `{ chatId, stage }` |
| `COPILOT_STATUS` | staff | `{ chatId, status: 'OK' \| 'UNAVAILABLE' \| 'OFF' }` |
| `SUMMARY_UPDATED` | staff | `{ chatId, summary: SummaryDto }` |
| `WHISPER` | staff | `{ chatId, message }` (type WHISPER; **never** the talker room) |
| `TRANSFER_REQUESTED` / `TRANSFERRED` | staff + lobby | `{ chatId, toListenerId? }` |
| `ALERT` | supervisors / user | `{ type: 'RISK_HIGH' \| 'LISTENER_DISCONNECTED' \| 'TRANSFER_REQUESTED' \| 'HIGH_RISK_WAITING'; chatId; level?; at }` |
| `RISK_FLAG_UPDATED` | staff | `{ chatId, flag: RiskFlagDto }` — additive: a flag was acknowledged (clears a banner without re-alerting) |
| `ERROR` | either | `{ code, message }` |

### 6.4 Presence and connection liveness (Redis)
- `hl:presence:{tenantId}` hash: `userId → { status, at }`.
- `hl:conn:listener:{userId}` and `hl:conn:talker:{talkerId}`: `1` with `EX 45`, refreshed on
  connect + every `HEARTBEAT`; deleted on disconnect.
- A listener is **available** iff presence `AVAILABLE` **and** their conn key is live.
- `hl:typing:{chatId}:listener`: `EX 4`, set on listener `USER_TYPING`.

### 6.5 Lifecycle sweep
`HelplineLifecycleService` runs every 15 s on each replica, guarded by `RedisService.acquireLock('hl:sweep', 14)`
(skipped when `NODE_ENV === 'test'` or `HELPLINE_SWEEP=off`). Per tenant settings:

| Condition | Action |
|---|---|
| WAITING, `now - wait_started_at > maxWaitMinutes` | end `WAIT_EXPIRED`; talker gets `CHAT_ENDED` + resources in UI |
| WAITING, talker conn key missing ≥ 2 min | set `abandoned_at` (hidden from lobby) |
| WAITING, `abandoned_at` older than 10 min | end `QUEUE_ABANDONED` |
| talker reconnects while abandoned | clear `abandoned_at` (original `wait_started_at` keeps their place) |
| ACTIVE, talker conn missing ≥ `idleEndMinutes` | end `TALKER_DISCONNECTED` |
| ACTIVE, listener conn missing ≥ 30 s | talker SYSTEM `LISTENER_RECONNECTING` (once) |
| ACTIVE, listener conn missing ≥ 3 min | staff `PARTICIPANT_STATUS` + monitor flag |
| ACTIVE, listener conn missing ≥ 10 min | supervisor `ALERT LISTENER_DISCONNECTED` (once) |
| listener back after `LISTENER_RECONNECTING` | talker SYSTEM `LISTENER_BACK` |

"Missing since" timestamps live in Redis (`hl:gone:*`) so a replica crash is detected via key expiry.

### 6.6 Claim
```sql
UPDATE helpline_chats
   SET status = 'ACTIVE', listener_id = $user, claimed_at = now(),
       previous_listener_ids = CASE WHEN listener_id IS NOT NULL THEN previous_listener_ids || listener_id ELSE previous_listener_ids END,
       transfer_requested_at = NULL, transfer_target_listener_id = NULL
 WHERE id = $chat AND tenant_id = $tenant
   AND (status = 'WAITING' AND abandoned_at IS NULL
        OR status = 'ACTIVE' AND transfer_requested_at IS NOT NULL AND listener_id <> $user)
   AND (transfer_target_listener_id IS NULL OR transfer_target_listener_id = $user)
RETURNING *;
```
Pre-checks: caller AVAILABLE (`HELPLINE_NOT_AVAILABLE`), active count < `min(profile.max, org cap)`
(`HELPLINE_AT_CAPACITY`). Zero rows → `HELPLINE_ALREADY_CLAIMED`. On success: SYSTEM `ACCEPTED`
(talker-visible, `params.listenerName`), `CLAIMED`/`TRANSFERRED` event, lobby update, listener joins
`staff:{chatId}`.

---

## 7. Talker-facing copy (Phase 0 draft — needs legal review before a real pilot)

Consent screen, in order (confidentiality limits **before** any disclosure, short enough to read):
1. What this is: a private text chat with a trained listener from *{org}*.
2. What it is not: not an emergency service — emergency numbers shown right here.
3. AI assistance: the listener uses AI tools that read the conversation to help them respond and
   notice if you may be at risk. **Every message you receive is written by a person.**
4. Confidentiality and its limits: what you share stays within *{org}*'s helpline team, which may
   include a supervisor. If you or someone else may be in danger, the team may follow its safety
   procedure. (Never an unconditional promise.)
5. Retention: kept for *{N}* days, then deleted. Delete it yourself any time.
6. Privacy on a shared device: use Quick exit; closing the tab ends the chat on this device.
7. Optional `ageNotice` from org settings.
Then display name (optional) and language, and **Start chat**.

Default emergency resources (en): "If you are in immediate danger, call 112. Tele-MANAS offers free,
24×7 mental-health support: call 14416 or 1-800-891-4416." Hindi default provided; other languages
fall back to English until an org edits them.

---

## 8. Org settings (`TEXT_HELPLINE_SETTINGS`)

```ts
interface HelplineHours { tz: string; weekly: { day: 0 | 1 | 2 | 3 | 4 | 5 | 6; open: string /* HH:MM */; close: string }[] }
interface HelplineSettings {
  retentionDays: number;                      // default 90; 0 = keep (logged at info)
  hours: HelplineHours | null;                // null = open whenever a listener is Available
  languages: string[];                        // default ['en','hi']
  allowQueueWhenNoListeners: boolean;         // default false
  maxWaitMinutes: number;                     // 30
  idleEndMinutes: number;                     // 15
  maxWaitingTalkers: number;                  // 50
  orgMaxConcurrentPerListener: number;        // 3
  emergencyResources: Record<string, string>; // auto-sent on HIGH risk, once per chat
  closingMessage: Record<string, string>;
  escalationChecklist: string[];
  supervisorAlertChannels: { inApp: boolean; push: boolean; slackWebhookUrl: string | null }; // only https://hooks.slack.com/ accepted
  listenerSupportContact: string | null;
  ageNotice: string | null;
  copilot: { suggestions: boolean; nudges: boolean; riskClassifier: boolean; rollingSummaryEveryTurns: number }; // true,true,true,4
  riskHighConfidence: number;                 // 0.70
  summaryFields: { key: string; label: string; description: string }[];
}
```
Default `escalationChecklist`: ask directly about thoughts of suicide or self-harm; ask about a plan,
means and timeframe; share the emergency resources; tell a supervisor now (use Alert supervisor);
stay with them — don't end the chat while they are at risk; agree a next step and who they can be
with. Default `summaryFields`: `presenting_concern` (What they came to talk about), `feelings` (How
they are feeling), `risk` (Any risk discussed, and what was agreed), `supports` (What they have tried
and who supports them), `next_step` (Agreed next step).

---

## 9. Copilot

### 9.1 ally-ai endpoints (`app/api/v1/endpoints/helpline.py`, `app/core/helpline/`)

`POST /api/v1/helpline/risk` — always 200.
```py
class HelplineRiskRequest: message: str; recent: list[{role: 'talker'|'listener', content: str}] = []  # ≤4, oldest first
                           language: str = 'en'; prompts: dict | None
class HelplineRiskResponse: is_crisis: bool = False; confidence: float = 0.0; signal: str = ""   # verbatim substring of `message`, ≤120 chars
                            subject: Literal['SELF','OTHER','UNCLEAR'] = 'UNCLEAR'; failed: bool = False; provider: str = ""; model: str = ""
```
Prompt `app/prompts/helpline/risk_classify.txt` (code `ally_ai_helpline_risk_classify`) — written for
a **person in distress talking to a listener**, not a worker asking a bot. False-positive-biased,
indirect phrasing, Hinglish and Indic scripts, "my friend is…" → `subject: OTHER`. `signal` is
logged to `phi_logger` only.

`POST /api/v1/helpline/turn` — always 200.
```py
class HelplineTurnRequest: messages: list[{role: 'talker'|'listener', content: str}]  # last ≤12, oldest first
                           rolling_summary: str = ""; language: str = 'en'; include_nudge: bool = False; prompts: dict | None
                           risk_level: Literal['NONE','ELEVATED','HIGH'] = 'NONE'        # the chat's current risk_level
                           risk_subject: Literal['SELF','OTHER','UNCLEAR',''] = ''       # subject of the latest classifier flag, '' if none
class HelplineTurnResponse: stage: Literal['Engage','Understand','Support','Close'] | ""; nudge: str = ""  # ≤240 chars, "" when not requested
                            suggestions: list[{text: str, skill_key: str}]   # 2-3, in `language`, each ≤300 chars
                            failed: bool = False; provider: str = ""; model: str = ""
```
`skill_key` ∈ `rapport, confidentiality, feelings, empathy, harm, functioning, explanation, family,
goals, hope, coping, psychoeducation, feedback, verbal`. Prompt `app/prompts/helpline/copilot_turn.txt`
(code `ally_ai_helpline_copilot_turn`), grounded in tentative, validating language: validate →
normalise → invite reflection; never "I know how you feel". A post-generation filter drops any
suggestion that promises unconditional confidentiality, diagnoses, or mentions medication/dosage.

Default models (overridable per prompt row, like every ally-ai call): `/helpline/turn` →
`gpt-4.1-mini`; `/helpline/risk` → `gpt-4o-mini` (the ally-ai pinned default).

### 9.2 ally-be orchestration (`HelplineCopilotService`)
On each persisted talker TEXT message, off the socket path:
1. **Keyword screen** (sync, tenant + global rules of **every** language → HIGH/ELEVATED). Every
   language, not just the chat's + English: a talker who picks English and writes Devanagari or
   Hinglish would otherwise be screened against nothing, and rules cannot match across scripts.
   Built in Phase 1 (`HelplineRiskService.screenTalkerMessage`); HIGH-only side effects (§9.3 alerts,
   auto-resources) plug into `HelplineRiskService.onHighRisk(chat, flag)`.
2. **Risk classifier** (`POST /helpline/risk`, timeout 3 s, no retry) if `copilot.riskClassifier`:
   `is_crisis && confidence ≥ riskHighConfidence` → HIGH; `is_crisis` below → ELEVATED; `failed` → no
   flag, logged.
3. **Copilot turn**, debounced 2.5 s after the talker's latest message (skip if a newer talker message
   arrived), timeout 6 s, if `copilot.suggestions || copilot.nudges`. `include_nudge` only when nudges on,
   `nudge_count < 10`, ≥ 2 talker turns since the last nudge, and not the first talker turn. If
   `hl:typing:{chatId}:listener` is live, hold the emit up to 4 s, then emit anyway.
4. **Rolling summary** every `rollingSummaryEveryTurns` talker turns (async, existing `/summary/note`
   with the org's `summaryFields` as `keys`/`key_descriptions`); **HANDOFF** on transfer; **FINAL** on end.
A failure emits `COPILOT_STATUS UNAVAILABLE` and nothing else.

### 9.3 Risk protocol
```
HIGH     → RISK message (staff) + helpline_risk_flags row; chat.risk_level = HIGH; priority 100 if WAITING
         → supervisors: in_app_notifications + FCM push + optional Slack, deduped 1 per chat per 10 min,
           payload names chat + level + source, never the text
         → emergencyResources[language] → talker as SYSTEM 'RESOURCES', once per chat (resources_sent_at)
         → HIPAA audit HELPLINE_RISK_FLAGGED {chatId, level, source} (+ signal, audit logger only)
ELEVATED → RISK message + flag row + banner; no alert, no resources
Ack      → listener marks CONFIRMED / FALSE_POSITIVE (+ optional note) → feeds the calibration view
```

### 9.4 Registry + LlmTask
New `LlmTask`: `HELPLINE_RISK_CLASSIFY = 'helpline_risk_classify'`, `HELPLINE_COPILOT_TURN = 'helpline_copilot_turn'`,
`HELPLINE_QA_JUDGE = 'helpline_qa_judge'` (ally-be enum, ally-ai `LLMTask`, and `TASK_AREA` in
`roleplay-cost-analytics.repository.ts`). Registry rows: `helpline-risk-screen`, `helpline-copilot-turn`
(ally-ai), `helpline-rolling-summary`, `helpline-final-summary` (ally-ai `/summary/note`, task
`DYNAMIC_SUMMARY`), `helpline-qa-judge` (ally-be, tier REASONING, `neverFallback`).

---

## 10. Supervision, QA, retention

- **Whisper**: persisted `WHISPER` (staff-only), emitted to `staff:{chatId}`. Excluded from any talker
  export.
- **Transfer**: sets `transfer_requested_at` (+ optional target); HANDOFF summary generated; talker
  gets SYSTEM `TRANSFERRING`; chat appears in the lobby as `kind: 'TRANSFER'`; claim moves the previous
  listener into `previous_listener_ids` (read-only). **Assign**: supervisor points a WAITING or
  transfer-pending chat at one listener (`transfer_target_listener_id`) and alerts them.
  **Take over**: supervisor becomes listener of record immediately.
- **Block**: supervisor-only; ends `TALKER_BLOCKED`, revokes token, refuses new sessions from the same
  `ip_hash` for 24 h with neutral copy.
- **QA**: scheduler `30min` job picks ENDED chats with `qa_status IS NULL`, ≥ 3 listener messages and
  ≥ 300 listener chars (else `SKIPPED`), builds helper lines from listener messages and client lines from
  talker messages, runs the helping-skills judge (`FoundationalSkillsJudgeService`, task
  `HELPLINE_QA_JUDGE`), writes `helpline_qa_scores`. Visible to the listener (own) and supervisors.
  Copy: strengths → specific improvements with a way to practise → positive close. **No leaderboard,
  no points, no ranking.** Levels are "score 1–4".
- **Retention**: hourly, batches of 500, per tenant `retentionDays`: blanks `helpline_messages.content`
  (all types) to `'[erased]'`, `helpline_talker_feedback.comment`, `helpline_chat_summaries.fields`,
  `helpline_risk_flags.outcome_note`, `helpline_talkers.display_name → 'Anonymous'`; sets `erased_at`.
  Also drops suggestion text from `helpline_messages.metadata.suggestions`, nulls
  `helpline_talkers.user_agent`, and nulls `ip_hash` unless the talker is blocked (the hash exists for
  the block window). Retention selects chats **ended** before the cutoff, so a chat is blanked whole.
  Keeps counts, levels, scores, timings. **Erasure** does the same for one chat immediately. Logged
  with counts only.
- **Audit events**: `HELPLINE_SESSION_CREATED`, `HELPLINE_CHAT_CLAIMED`, `HELPLINE_RISK_FLAGGED`,
  `HELPLINE_RESOURCES_SENT`, `HELPLINE_CHAT_TRANSFERRED`, `HELPLINE_CHAT_ENDED`,
  `HELPLINE_TRANSCRIPT_ACCESSED`, `HELPLINE_ERASURE_REQUESTED`, `HELPLINE_TALKER_BLOCKED`.

---

## 11. Frontend surfaces (ally-web)

**Talker page** — `ally-helpline-dashboard`, route `/talk/:tenantCode` under `PublicLayout`. Its own
RTK API slice with a plain `fetchBaseQuery` (the app's `baseAPI` logs out on 401, which would bounce a
talker to `/login`). Guest token in `sessionStorage` key `allyHelplineGuest:<tenantCode>`. Screens:
consent → waiting (position, estimate, resources card, composer, Leave) → chat (bubbles, typing,
sent ticks, distinct system messages, **Quick exit**, End chat, kebab → Delete my conversation) →
ended (closing text, one-question rating, resources, Delete). Closed/after-hours and not-available
states. Root carries `ph-no-capture`; PostHog events carry no content.

**Listener workspace** — nav tab **Helpline** (`useCanUseTextHelpline` = helpline permission AND
`GET /v1/helpline/enabled`). Routes `/helpline` (lobby), `/helpline/chat/:chatId`, `/helpline/history`,
`/helpline/monitor`, `/helpline/qa`, `/helpline/team`. Chat view: transcript + composer | copilot panel
(risk banner + checklist until acknowledged, suggestions that **insert, never send**, nudge + stage,
rolling summary, whispers) | talker info + actions. End → summary review modal. After a HIGH-risk chat
ends: a "take a minute" interstitial with the listener support contact.

**Admin console** — Organization detail → **Text helpline** tab: enable toggle, public link, settings
form (every non-obvious field has a tooltip).
