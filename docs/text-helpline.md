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
   **and** `TEXT_HELPLINE_ENABLED` for the caller's tenant — with one narrow exception: the listener of
   record of an ACTIVE chat keeps that chat after a switch-off, so nobody in distress is dropped
   mid-conversation (§5.4).
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
body**, never the text), `resources_sent bool default false`, `supervisors_alerted int null`
(second pass, migration `1975810000000`; §9.3), `acknowledged_by int null`,
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

**PHI at rest is encrypted** (second pass): `helpline_messages.content` (every type) and
`metadata.suggestions[].text`, `helpline_chat_summaries.fields` (stored `{ "enc": "<ciphertext of the
JSON object>" }`), `helpline_talker_feedback.comment`, `helpline_risk_flags.outcome_note` and
`helpline_talkers.display_name`. AES-256-GCM via `CryptoService` and `PHI_DATA_ENCRYPTION_KEY` (the
Scribe transcript key), wrapped by `HelplineContentCipher`; values are `hlenc:v1:<base64>`. Encrypt on
write, decrypt in the read paths — `HelplineMessageRepository` does both for messages, so services,
serialisers, the lobby preview, LLM context and risk-signal offsets (which index the **plaintext**)
never see ciphertext. The keyword screen runs on the plaintext before the row is written. `[erased]`
stays plaintext and short-circuits decryption; an unprefixed value is legacy plaintext and is read as
is; a prefixed value that will not decrypt reads as `[unreadable]` (never a throw). A missing key
fails the write — content is never stored in the clear. Migration `1975800000000` widens
`display_name`, `outcome_note` and `comment` to `text`; their plaintext limits (40 / 500 / 1,000) are
enforced on write. No API shape changes: every DTO carries plaintext.

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

All require `@RequireHelplineEnabled()`. Permission per row. The chat-scoped rows marked **†** use
`@RequireHelplineEnabledForChat()` instead, which also admits the listener of record while the
helpline is switched off (§5.4).

| Route | Permission | Body / query | Returns |
|---|---|---|---|
| `GET /v1/helpline/enabled` | authenticated only | — | `{ enabled: boolean; continuingChatIds: string[] }` (for the nav gate; no helpline permission needed, no 403). `continuingChatIds`: while disabled, the ACTIVE chats the caller is still listener of record for (§5.4) — keep those reachable; always `[]` when enabled |
| `GET /v1/helpline/me` | `view:helpline:lobby` | — | `MeDto` |
| `PUT /v1/helpline/me/profile` | `edit:helpline:presence` | `{ displayName?, maxConcurrentChats?, languages?, notificationsEnabled? }` | `MeDto` |
| `PUT /v1/helpline/me/presence` | `edit:helpline:presence` | `{ status: 'AVAILABLE' \| 'AWAY' }` | `MeDto` |
| `GET /v1/helpline/lobby` | `view:helpline:lobby` | — | `LobbyDto` |
| `POST /v1/helpline/chats/:id/claim` | `edit:helpline:claim` | — | `ChatDetailDto` · 409 `HELPLINE_ALREADY_CLAIMED` · 409 `HELPLINE_AT_CAPACITY` · 409 `HELPLINE_NOT_AVAILABLE` |
| `GET /v1/helpline/chats/:id` † | `view:helpline:chat` | — | `ChatDetailDto` (audited `HELPLINE_TRANSCRIPT_ACCESSED` when ENDED) |
| `GET /v1/helpline/chats/:id/messages?afterId=` † | `view:helpline:chat` | — | `{ messages: StaffMessageDto[] }` |
| `POST /v1/helpline/chats/:id/end` † | `edit:helpline:end` | — | `ChatDetailDto` |
| `PUT /v1/helpline/chats/:id/summary` † | `edit:helpline:summary` | `{ fields: Record<string,string> }` | `SummaryDto` (FINAL, `editedBy`) |
| `GET /v1/helpline/chats?scope=mine\|all&status=ENDED&page=1&limit=25` | `view:helpline:chat` (`all` needs `view:helpline:monitor`) | — | `{ items: ChatListItemDto[]; total }` |
| `POST /v1/helpline/chats/:id/risk-flags/:flagId/ack` † | `view:helpline:copilot` | `{ outcome: 'CONFIRMED' \| 'FALSE_POSITIVE'; note?: string }` | `RiskFlagDto` |
| `POST /v1/helpline/chats/:id/copilot-feedback` † | `view:helpline:copilot` | `{ messageId: number; index?: number; rating: 'UP' \| 'DOWN' }` | `204`. SUGGESTION: `index` required (400 otherwise) → `metadata.feedback[index]`; NUDGE → `metadata.feedback`; latest rating wins; any other row → 404 |
| `POST /v1/helpline/chats/:id/alert-supervisor` † | `view:helpline:copilot`, listener of record of an ACTIVE chat | `{ note?: string /* ≤ 300, staff-only */ }` | `{ alertedCount: number }` (§9.3) · 403 `HELPLINE_NOT_LISTENER` · 409 `HELPLINE_CHAT_ENDED` |
| `POST /v1/helpline/chats/:id/transfer` | `edit:helpline:transfer` **or** listener of record with `edit:helpline:end` (route floor: `edit:helpline:end`) | `{ targetListenerId?: number }` | `ChatDetailDto` · ACTIVE only (WAITING 400, ENDED 409) · target must be a listener of the tenant, not the current one (400) · repeat while pending is idempotent (a new target re-aims it) |
| `POST /v1/helpline/chats/:id/assign` | `edit:helpline:transfer` | `{ listenerId: number }` | `ChatDetailDto` (WAITING, not abandoned, or transfer-pending → that listener; otherwise 409 `HELPLINE_ALREADY_CLAIMED`) |
| `POST /v1/helpline/chats/:id/take-over` | `edit:helpline:transfer` | — | `ChatDetailDto` (`myAccess: LISTENER`) · ACTIVE only (WAITING 400 — claim it; ENDED 409) |
| `POST /v1/helpline/chats/:id/whisper` | `edit:helpline:whisper` | `{ content: string /* ≤ 2000 */ }` | `StaffMessageDto` (type WHISPER) · empty 400 · ENDED 409 |
| `POST /v1/helpline/talkers/:talkerId/block` | `edit:helpline:transfer` | `{ reason?: string }` | `204` (ends chat `TALKER_BLOCKED`; `reason` is not stored — the audit records only whether one was given) · unknown talker 404 |
| `GET /v1/helpline/monitor` | `view:helpline:monitor` | — | `MonitorDto` |
| `GET /v1/helpline/risk-flags?outcome=&days=7` | `view:helpline:monitor` | `days` 1–90 (default 7); `outcome` narrows `items` only | `RiskCalibrationDto` (calibration view; newest first, ≤ 200 items; audited `HELPLINE_TRANSCRIPT_ACCESSED { view: 'risk-calibration' }` because items carry live signals) |
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
Turning `enabled` off refuses new work and never cuts a listener off mid-conversation (second pass):

- **Refused from that moment** (`HELPLINE_DISABLED`): new talker sessions, `lobby`, `claim`,
  `me`/presence (and the `PRESENCE_SET AVAILABLE` socket event — `AWAY` is still accepted), `monitor`,
  `risk-flags`, every supervision route, QA, team, and any staff socket handshake from a user with no
  ACTIVE chat of record. Read-only access over a socket (`JOIN_CHAT`/`SYNC_SINCE` as a monitoring
  supervisor or previous listener) is refused per event, so a socket opened before the switch-off
  cannot keep monitoring after it.
- **Still served to the listener of record of an ACTIVE chat**, for that chat only, until it ends:
  the † routes (`GET chats/:id`, `messages`, `end`, `PUT summary`, risk-flag `ack`,
  `copilot-feedback`, `alert-supervisor`) plus `SEND_MESSAGE`/typing/`SYNC_SINCE` over the socket. A
  new handshake from that listener is accepted as **restricted**: it joins only `user:{id}` and the
  `staff:{chatId}` rooms of their ACTIVE chats — no `lobby:`, no `supervisors:`. After the chat ends
  the † routes stay open to them for 60 minutes (read back, save the summary), then close.
- Open chats are not force-ended; the copilot and the risk protocol keep running for them. They end
  through the listener, the talker or the lifecycle sweep. Re-enabling restores everything.

`GET /v1/helpline/enabled` returns `continuingChatIds` so the workspace can keep those chats reachable
while the nav gate is off.

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
  systemKind: string | null;        // talker kinds + staff-only: TALKER_DISCONNECTED, TALKER_RECONNECTED, TAKEN_OVER, TRANSFERRED, ASSIGNED, SUPERVISOR_REQUESTED
                                    // (staff-only SYSTEM rows carry metadata.params.listenerName where it applies; SUPERVISOR_REQUESTED's content is the listener's note, may be '')
  content: string;
  parentMessageId: number | null;
  visibleToTalker: boolean;
  metadata: Record<string, unknown> | null;
  // SUGGESTION: { suggestions: { index: number; text: string; skillKey: string }[]; accepted?: number[]; feedback?: Record<number,'UP'|'DOWN'> }
  // NUDGE: { skillKey?: string; feedback?: 'UP'|'DOWN' }   STAGE: { stage: string }
  // RISK: { flagId: string; level; source; confidence; subject }
  // TEXT from listener: { fromSuggestion?: { messageId: number; index: number; editedDistance: number /* 0…1 */ } }
  createdAt: string; erased: boolean;
}
interface RiskFlagDto {
  id: string; messageId: number; level: 'ELEVATED' | 'HIGH'; source: 'KEYWORD' | 'CLASSIFIER';
  confidence: number | null; subject: 'SELF' | 'OTHER' | 'UNCLEAR' | null;
  signal: string | null;            // re-derived from offsets on the live message body; null once erased
  resourcesSent: boolean;
  supervisorsAlerted: number | null; // null = n/a (ELEVATED); 0 = HIGH, nobody alerted; n = supervisors reached (§9.3)
  acknowledgedAt: string | null; acknowledgedByName: string | null;
  outcome: 'UNREVIEWED' | 'CONFIRMED' | 'FALSE_POSITIVE'; outcomeNote: string | null;
  createdAt: string;
}
interface SummaryDto { kind: 'ROLLING' | 'HANDOFF' | 'FINAL'; fields: Record<string, string>; throughMessageId: number; editedByName: string | null; version: number; updatedAt: string }
interface MonitorDto {
  tiles: { waiting: number; active: number; listenersAvailable: number; openHighFlags: number /* unacknowledged HIGH flags on WAITING/ACTIVE chats */ };
  activeChats: (ChatListItemDto & { lastMessageAgeSeconds: number | null; listenerConnected: boolean; talkerConnected: boolean; transferPending: boolean; openFlags: number /* unacknowledged */ })[];
                                    // ACTIVE chats, risk HIGH → NONE, then the longest silence first
  waiting: LobbyEntryDto[];         // = the lobby (NEW + TRANSFER entries)
  listeners: { userId: number; displayName: string; presence: Presence; activeChatCount: number; maxConcurrentChats: number; languages: string[] }[];
                                    // every user of the tenant holding view:helpline:lobby (platform staff excluded), OFFLINE when no live socket — the assign picker
}
interface RiskFlagRowDto extends RiskFlagDto {
  chatId: string; chatStatus: 'WAITING' | 'ACTIVE' | 'ENDED'; chatRiskLevel: 'NONE' | 'ELEVATED' | 'HIGH';
  listener: { id: number; displayName: string } | null; erased: boolean;
}
type OutcomeCounts = { UNREVIEWED: number; CONFIRMED: number; FALSE_POSITIVE: number };
interface RiskCalibrationDto {
  items: RiskFlagRowDto[];
  counts: OutcomeCounts;                                         // whole window, not narrowed by `outcome`
  bySource: { KEYWORD: OutcomeCounts & { total: number }; CLASSIFIER: OutcomeCounts & { total: number } };
  classifierByConfidence: ({ from: number; to: number } & OutcomeCounts)[];   // bands 0–.5, .5–.6 … .9–1
  riskHighConfidence: number;                                    // the org's current threshold
  days: number;
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
- User: existing user-JWT verification; requires `view:helpline:lobby` **or** `view:helpline:monitor`, and the tenant gate → `socket.data = { kind: 'staff', userId, tenantId, permissions }`; joins `user:{userId}`, `lobby:{tenantId}` (lobby perm), `supervisors:{tenantId}` (monitor perm), and `staff:{chatId}` for every ACTIVE chat where they are listener of record. With the helpline switched off, a user who is listener of record of ≥ 1 ACTIVE chat is accepted with `restricted: true` and joins only `user:{userId}` + those `staff:{chatId}` rooms (§5.4); anyone else is refused.
- **Reconnect** (e.g. after a server restart): the handshake re-joins the talker to `talker:{chatId}` and the listener of record to `staff:{chatId}` of every ACTIVE chat. Rooms joined with `JOIN_CHAT` (monitoring, read-only previous listener) are **not** restored — the client re-sends `JOIN_CHAT` and then `SYNC_SINCE` for each open chat view after every reconnect.
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
| `SUGGESTIONS` | staff | `{ chatId, message: StaffMessageDto }` (type SUGGESTION). SUGGESTION, NUDGE and WHISPER rows go out **only** on their own event, never also as `MESSAGE_RECEIVED`; `GET messages` / `SYNC_SINCE` return them with every other type |
| `NUDGE` | staff | `{ chatId, message }` |
| `STAGE` | staff | `{ chatId, stage }` |
| `COPILOT_STATUS` | staff | `{ chatId, status: 'OK' \| 'UNAVAILABLE' \| 'OFF' }` |
| `SUMMARY_UPDATED` | staff | `{ chatId, summary: SummaryDto }` |
| `WHISPER` | staff | `{ chatId, message }` (type WHISPER; **never** the talker room) |
| `TRANSFER_REQUESTED` / `TRANSFERRED` | staff + lobby | `{ chatId, toListenerId? }` — TRANSFER_REQUESTED carries the target if one was named; TRANSFERRED (on the transfer claim) carries the new listener. The previous listener stays in `staff:{chatId}` read-only and receives the READ_ONLY `CHAT_UPDATED` |
| `ALERT` | supervisors / user | `{ type: 'RISK_HIGH' \| 'HIGH_RISK_WAITING' \| 'LISTENER_DISCONNECTED' \| 'LISTENER_REQUESTED_HELP' \| 'TRANSFER_REQUESTED' \| 'ASSIGNED'; chatId; level?; at }` — `level` only on the two risk types. `supervisors:{tenantId}` gets RISK_HIGH, HIGH_RISK_WAITING, LISTENER_DISCONNECTED, LISTENER_REQUESTED_HELP, TRANSFER_REQUESTED; `user:{id}` gets ASSIGNED (and TRANSFER_REQUESTED when a transfer names them) |
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
| ACTIVE, listener conn missing ≥ 10 min | supervisor alert `LISTENER_DISCONNECTED` (once per chat) through the §9.3 alert service: socket `ALERT` + in-app/push/Slack per org settings + `SUPERVISOR_ALERTED` |
| listener back after `LISTENER_RECONNECTING` | talker SYSTEM `LISTENER_BACK` |

"Missing since" timestamps live in Redis (`hl:gone:*`) so a replica crash is detected via key expiry.

### 6.6 Claim
```sql
UPDATE helpline_chats
   SET status = 'ACTIVE', listener_id = $user, claimed_at = now(),
       previous_listener_ids = CASE WHEN listener_id IS NOT NULL THEN previous_listener_ids || listener_id ELSE previous_listener_ids END,
       transfer_requested_at = NULL, transfer_requested_by = NULL, transfer_target_listener_id = NULL,
       taken_over_at = NULL   -- second pass: the claimer is a listener, not a supervisor who took over
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
   `is_crisis && confidence ≥ riskHighConfidence` → HIGH; `is_crisis` below → ELEVATED; `failed` (or
   unreachable) → no flag + `COPILOT_STATUS UNAVAILABLE`. Request: the message, the last 4 earlier TEXT
   turns (`talker`/`listener`, decrypted), the chat language and prompt overrides. The flag goes through
   `HelplineRiskService.raiseFlag` — the keyword path — with `source: CLASSIFIER`, `confidence`,
   `subject`, and the offsets of the verbatim `signal` in the plaintext body (null when the model
   paraphrased). **Dedupe:** never a second CLASSIFIER flag for one message, and nothing when the
   keyword screen already flagged it at the same or a higher level (a classifier HIGH over a keyword
   ELEVATED is recorded). Runs in the waiting room too.
3. **Copilot turn** (`POST /helpline/turn`, timeout 6 s, no retry) if `copilot.suggestions ||
   copilot.nudges`, **ACTIVE chats only**. Debounced 2.5 s per talker burst: the talker's latest TEXT id
   is stored at `hl:copilot:latest:{chatId}` and a timer that fires on any replica skips itself when a
   newer id is there. The turn waits for that message's classifier result so a fresh flag shapes it.
   Request: last 12 TEXT turns, the latest ROLLING summary (`Label: value` lines), language,
   `include_nudge`, `risk_level` (chat), `risk_subject` (latest flag with a subject, else `''`).
   `include_nudge` only when nudges are on, `nudge_count < 10`, `talker_turns_since_nudge ≥ 2` and not
   the first talker turn. Results, if `hl:typing:{chatId}:listener` is live, are held up to 4 s first,
   and dropped if a newer talker message arrived meanwhile:
   - suggestions (when `copilot.suggestions` and the list is non-empty — an empty list writes nothing):
     ONE staff-only `SUGGESTION` row, `senderRole: COPILOT`, `content: 'Suggested replies'`,
     `metadata.suggestions: [{ index, text (≤ 300), skillKey }]` (unknown keys → `''`), parent = the talker
     message → `SUGGESTIONS { chatId, message }`;
   - a nudge, only when requested: staff-only `NUDGE` row (≤ 240 chars, parent = the talker message),
     `nudge_count + 1`, `talker_turns_since_nudge = 0` → `NUDGE { chatId, message }`;
   - the stage, only when it differs from the newest `STAGE` row: staff-only `STAGE` row
     (`metadata { stage }`) → `STAGE { chatId, stage }`;
   - then `COPILOT_STATUS OK` if the previous status was not OK.
   **Also one turn when a listener claims** a chat the talker has already written in (first claim or
   transfer claim), for the latest talker message — the first reply is the hardest.
4. **Rolling summary** every `rollingSummaryEveryTurns` talker turns (turns 4, 8, 12 … by default; also
   while WAITING), **HANDOFF** on a transfer request, **FINAL** on end — all the existing `/summary/note`
   with the org's `summaryFields` as `keys`/`key_descriptions`, request body redacted from logs, each
   followed by `SUMMARY_UPDATED`.
5. **Accepted suggestions:** a listener TEXT sent with `suggestion: { messageId, index }` carries
   `metadata.fromSuggestion { messageId, index, editedDistance }` (`editedDistance` = Levenshtein ÷ the
   longer length, 0 = sent as suggested … 1 = rewritten, two decimals), and the SUGGESTION row gets
   `index` added to `metadata.accepted` (a set) off the send path.
6. **Prompt overrides** for `ally_ai_helpline_risk_classify` / `ally_ai_helpline_copilot_turn` are read
   from the `prompts` table (cached 60 s) and sent keyed by full code. The prompt *text* is sent only when
   the row's dashboard override is on — otherwise the row holds a seeded copy that can be older than
   ally-ai's file; provider / model / temperature are sent whenever set.

A failure emits `COPILOT_STATUS UNAVAILABLE` and nothing else (no partial output). `ChatDetailDto.copilot`:
`status` = `OFF` when suggestions, nudges and the classifier are all off, else the last outcome
(`OK` until something fails); `stage` = the newest `STAGE` row's stage. Delivery never waits for any of
this — the send path only calls the hooks, which return synchronously.

### 9.3 Risk protocol
```
HIGH     → helpline_risk_flags row + RISK message (staff); chat.risk_level = HIGH; priority 100 if WAITING
         → emergencyResources[talker language] (→ org en → platform default en) → talker as SYSTEM
           'RESOURCES', once per chat (conditional UPDATE on resources_sent_at; never for an ENDED chat),
           also while WAITING; RESOURCES_SENT event; HIPAA audit HELPLINE_RESOURCES_SENT; CHAT_UPDATED
         → supervisor alert (HelplineAlertService), deduped 1 per chat per 10 min across replicas
           (Redis SET NX EX 600): ALERT to supervisors:{tenantId}, in-app + FCM push + optional Slack,
           SUPERVISOR_ALERTED event — payloads name the org, the level, the source and the listener's
           alias, never the text or the talker
         → flag.resources_sent / flag.supervisors_alerted recorded, THEN RISK_FLAGGED (so the banner is true)
         → HIPAA audit HELPLINE_RISK_FLAGGED {chatId, level, source} (+ signal, audit logger only)
ELEVATED → RISK message + flag row + banner; no alert, no resources (supervisorsAlerted: null)
Ack      → listener marks CONFIRMED / FALSE_POSITIVE (+ optional note) → feeds the calibration view
```

**Alert recipients**: users of the tenant (`users.tenant_id` = uuid or code) holding
`view:helpline:monitor` through `user_groups → groups → group_permissions → permissions` (cached 5 min),
excluding Ally platform-tier accounts, the chat's listener and whoever asked. **Channels**: the socket
`ALERT` always; one `in_app_notifications` row per recipient when `supervisorAlertChannels.inApp`
(`type` `HELPLINE_RISK_HIGH` | `HELPLINE_LISTENER_DISCONNECTED` | `HELPLINE_LISTENER_REQUESTED_HELP` |
`HELPLINE_CHAT_ASSIGNED`; `data { chatId, level, source, alert, screen: 'HelplineMonitor' }`); FCM data
push to their devices when `push`; a Slack POST (only `https://hooks.slack.com/…`, 3 s timeout, text =
org + level + source + the path `/helpline/monitor`) when set. Push and Slack are detached. **Copy**
(plain, specific, one next step):

| Alert | Title | Body |
|---|---|---|
| `RISK_HIGH` | High-risk flag in a helpline chat — open the monitor | "{alias}'s chat was flagged high risk by {the keyword screen \| the AI risk check}. [Emergency resources were sent to the talker.] Open the monitor to support the listener." |
| `HIGH_RISK_WAITING` | High-risk talker waiting in the helpline queue | "A waiting talker was flagged high risk by … and no listener has taken the chat yet. It is now first in the queue. Open the monitor to assign it." |
| `LISTENER_DISCONNECTED` | A helpline listener has been disconnected for 10 minutes | "{alias} lost their connection during an active chat and the talker is still there. Open the monitor to take over or reassign the chat." |
| `LISTENER_REQUESTED_HELP` | A listener asked for a supervisor | "{alias} pressed Alert supervisor in an active helpline chat. Open the monitor to join them." |

**`supervisorsAlerted`** on a flag: `null` = not applicable (ELEVATED); `0` = HIGH but nobody could be
alerted (no supervisor in the org, or the alert failed); `n` = supervisors reached by this flag's alert or
by the deduped alert (≤ 10 min old) that already covered the chat. Socket-only reach is counted (an
offline supervisor still gets the in-app row); Slack is not a supervisor and does not count. The banner
must not say "your supervisor has been alerted" unless it is ≥ 1.

**Alert supervisor** (`POST chats/:id/alert-supervisor`, the checklist's "tell a supervisor now"): the
listener of record of an ACTIVE chat; the same alert service with type `LISTENER_REQUESTED_HELP`, deduped
1 per chat per 2 min; the optional note (≤ 300) is stored encrypted on a staff-only SYSTEM message
`systemKind: 'SUPERVISOR_REQUESTED'` (sender = the listener; emitted as `MESSAGE_RECEIVED` to
`staff:{chatId}`) and never put in a notification; `SUPERVISOR_ALERTED { requestedBy }` event. Returns
`{ alertedCount }` (the deduped alert's count inside the window; 0 when the org has no supervisor — the
UI must say so).

### 9.4 Registry + LlmTask
New `LlmTask`: `HELPLINE_RISK_CLASSIFY = 'helpline_risk_classify'`, `HELPLINE_COPILOT_TURN = 'helpline_copilot_turn'`,
`HELPLINE_QA_JUDGE = 'helpline_qa_judge'` (ally-be enum; ally-ai `LLMTask` carries the first two, the
only ones it makes). **Deliberately absent from `TASK_AREA`** in `roleplay-cost-analytics.repository.ts`:
that map's areas are the three things a *learner* receives, and a task in it is averaged into the
per-roleplay-minute unit cost; helpline calls serve talkers and listeners, so they belong in the chart's
non-learner spend (a spec pins this). The helpline summaries are recorded as `DYNAMIC_SUMMARY`, which
`TASK_AREA` files as learner feedback — a known mis-attribution until `/summary/note` takes a task label.
Registry rows: `helpline-risk-screen`, `helpline-copilot-turn` (ally-ai), `helpline-rolling-summary`,
`helpline-final-summary` (ally-ai `/summary/note`, task `DYNAMIC_SUMMARY`), `helpline-qa-judge` (ally-be,
tier REASONING, `neverFallback`).

---

## 10. Supervision, QA, retention

- **Whisper**: persisted `WHISPER` (staff-only, `senderRole: SUPERVISOR`), emitted as `WHISPER` to
  `staff:{chatId}` only — never `MESSAGE_RECEIVED`, and the realtime guard drops it from any `talker:` room.
  Excluded from any talker export.
- **Transfer**: sets `transfer_requested_at` (+ optional target); HANDOFF summary generated; talker
  gets SYSTEM `TRANSFERRING`; chat appears in the lobby as `kind: 'TRANSFER'`; claim moves the previous
  listener into `previous_listener_ids` (read-only). **Assign**: supervisor points a WAITING or
  transfer-pending chat at one listener (`transfer_target_listener_id`) and alerts them.
  **Take over**: supervisor becomes listener of record immediately (conditional UPDATE; the replaced
  listener → `previous_listener_ids`, read-only; any pending transfer is cancelled); their sockets join
  `staff:{chatId}` on every replica; staff-only SYSTEM `TAKEN_OVER`; the talker sees only SYSTEM `ACCEPTED`
  with the new alias (never that a supervisor stepped in); `TAKEN_OVER` event; HIPAA audit
  `HELPLINE_CHAT_TRANSFERRED { takeOver: true }`. Staff-only SYSTEM `ASSIGNED` on assign, `TRANSFERRED` on a
  transfer claim. The assigned listener gets `ALERT { type: 'ASSIGNED' }` on `user:{id}` and an in-app
  notification `HELPLINE_CHAT_ASSIGNED`.
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
