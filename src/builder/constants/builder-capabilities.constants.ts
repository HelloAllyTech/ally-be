/**
 * The platform's reusable systems, one line each, written by a person.
 *
 * ## Why a hand-written list beside a generated catalog
 *
 * The catalog (`extract-catalog.mjs`, stored in `builder_repo_catalogs`) knows
 * that `src/skill-experiment` exists and that it has a `skill_experiments`
 * table. It cannot know that this is the thing to reach for when someone asks
 * to "A/B test challengers and make the winner the default". That sentence is
 * the gap that cost session 2bc3a5cf three admin corrections: the request named
 * every part of Auto-improve, and the interview proposed building it again
 * because nothing it read connected the words to the system. This list is that
 * connection — what a system is for, when a new feature should reuse it, and
 * where it extends — and it is the only part of the platform map a model does
 * not regenerate.
 *
 * ## Keeping it true
 *
 * `builder-capabilities.constants.spec.ts` fails when an entry names an ally-be
 * path that no longer exists, and lists the ally-be modules no entry covers
 * (it fails until the module gets a line or is exempted in `BUILDER_CAPABILITY_EXEMPT_MODULES`).
 * Paths are `repo:path` so an entry can point across repos.
 *
 * Write `reuseWhen` in the words a requester would use, not the words the code
 * uses: it is matched against requests, and nobody asks for "a skill
 * experiment variant router".
 */

export interface BuilderCapability {
  /** Stable slug; cited by lookups and evidence. */
  id: string;
  /** What people call it in the admin console or in conversation. */
  name: string;
  whatItIs: string;
  /** When a new feature should reuse or extend this instead of building its own. */
  reuseWhen: string;
  /** Where it is meant to be extended, when there is a designed seam. */
  extendVia?: string;
  /** `repo:path`, e.g. `ally-be:src/skill-experiment`. */
  modules: string[];
  docs?: string[];
  /** Admin console path, when it has a screen. */
  adminRoute?: string;
  /** Words a request might use for it. Matched case-insensitively. */
  keywords: string[];
}

export const BUILDER_CAPABILITIES: BuilderCapability[] = [
  {
    id: 'auto-improve',
    name: 'Auto-improve (System Skills → Auto-improve tab)',
    whatItIs:
      'Tests revised versions of a System Skill prompt on live traffic: a designer model drafts ' +
      'challengers, a router splits calls between champion and challenger, an LLM judge scores ' +
      'outputs against a rubric, and the experiment pauses when the best version reaches the ' +
      'target. An admin applies the winner.',
    reuseWhen:
      'A request wants to A/B test, compare or iterate prompt versions, generate challenger ' +
      'prompts, pick a winner automatically, or improve an AI output over time. Only prompts ' +
      'whose call site is "connected" (CONNECTED_SKILLS) can run it.',
    extendVia:
      'Connect a new call site in skill-experiment.constants.ts (CONNECTED_SKILLS) with a ' +
      'rubric. Outputs are scored by the LLM judge, except debriefs a learner rated: ' +
      'debrief-feedback writes that rating onto the observation as its score.',
    modules: ['ally-be:src/skill-experiment'],
    docs: ['ally-be:docs/skill-experiments.md'],
    adminRoute: '/manage-prompts?tab=experiments',
    keywords: [
      'a/b test',
      'ab test',
      'experiment',
      'challenger',
      'champion',
      'variant',
      'auto-improve',
      'auto improve',
      'rubric',
      'judge',
      'prompt version',
      'winning version',
    ],
  },
  {
    id: 'system-skills',
    name: 'System Skills (prompt registry)',
    whatItIs:
      'Every prompt the platform runs, by code, with its text, dashboard override and per-prompt ' +
      'model, provider and temperature. Prompts live as files in src/prompts and sync into the ' +
      'prompts table at boot; a dashboard edit with the override on serves the saved version.',
    reuseWhen:
      'A feature needs a new prompt, wants admins to edit a prompt without a deploy, or needs a ' +
      'per-prompt model choice. Do not hard-code prompt text in a service.',
    modules: ['ally-be:src/prompt', 'ally-be:src/prompts'],
    docs: ['ally-be:docs/prompts-folder.md', 'ally-be:docs/prompts-api.md'],
    adminRoute: '/manage-prompts',
    keywords: ['prompt', 'system skill', 'skill', 'prompt text', 'template'],
  },
  {
    id: 'ai-task-registry',
    name: 'AI task registry (AI Tasks tab)',
    whatItIs:
      'The canonical map of every model call on the platform — which action calls a model, which ' +
      'model serves it by default, and where in the code. Served at GET /v1/llm/tasks.',
    reuseWhen:
      'A request touches any AI output: look up which task produces it before designing a change. ' +
      'Every new model call must add a row in the same change.',
    modules: ['ally-be:src/llm'],
    docs: ['ally-be:docs/ai-task-registry.md'],
    adminRoute: '/ai-tasks',
    keywords: ['model', 'llm', 'ai call', 'which model', 'ai task', 'cost'],
  },
  {
    id: 'llm-completion',
    name: 'LLM access (agent providers and one-shot completions)',
    whatItIs:
      'Provider-neutral model access for ally-be: streamed, tool-capable agent passes for ' +
      'interview loops, and LlmCompletionService for one-shot calls with the registry’s model ' +
      'resolution, usage attribution and tier fallback.',
    reuseWhen:
      'Any new ally-be feature that calls a model. Use LlmCompletionService for a single call; ' +
      'never construct a provider SDK client directly. src/ai-chat is the older text-only SSE ' +
      'streamer (still behind the post-session debrief chat); new work goes through llm-agent.',
    modules: ['ally-be:src/llm-agent', 'ally-be:src/ai-chat'],
    keywords: ['llm', 'completion', 'openai', 'gemini', 'anthropic', 'agent'],
  },
  {
    id: 'scheduler',
    name: 'Scheduled tasks',
    whatItIs:
      'The in-process scheduler: modules register a named task with an interval through ' +
      'scheduledTaskRegistry.register from a *-scheduler-registration.service.ts, on one of the ' +
      'runner’s intervals: 5min, 15min, 30min, hourly, daily, weekly or monthly.',
    reuseWhen:
      'A feature needs a periodic or background job (weekly digest, nightly recompute, ' +
      'reconcile). Register a task; do not add cron infrastructure.',
    modules: ['ally-be:src/scheduler'],
    keywords: [
      'cron',
      'scheduled',
      'periodic',
      'nightly',
      'weekly',
      'background job',
    ],
  },
  {
    id: 'notifications',
    name: 'Notifications (email, push, in-app, Slack)',
    whatItIs:
      'One service for telling a user something: email, mobile push via device tokens, in-app ' +
      'notifications, and Slack.',
    reuseWhen:
      'A feature needs to notify, remind or alert someone. Reuse it rather than calling a mail or ' +
      'push provider directly.',
    modules: ['ally-be:src/notification'],
    keywords: [
      'notify',
      'notification',
      'email',
      'push',
      'alert',
      'remind',
      'slack',
    ],
  },
  {
    id: 'engagement-reminders',
    name: 'Engagement reminders',
    whatItIs:
      'Evaluates learners against reminder rules on a schedule and sends nudges through ' +
      'notifications.',
    reuseWhen:
      'A request wants to nudge inactive learners or remind them to practise. Extend the rules ' +
      'rather than adding a second reminder loop.',
    modules: ['ally-be:src/engagement-reminder'],
    keywords: ['reminder', 'nudge', 'inactive', 're-engage', 'streak reminder'],
  },
  {
    id: 'product-analytics',
    name: 'Product analytics (PostHog)',
    whatItIs:
      'A single process-wide PostHog client for server-side events, plus the frontends’ own ' +
      'PostHog capture.',
    reuseWhen:
      'A feature needs to measure usage or a funnel. Capture events through the existing client; ' +
      'do not add another analytics vendor.',
    modules: ['ally-be:src/posthog'],
    docs: ['ally-web:docs/new-posthog-event-adding-guide.md'],
    keywords: [
      'analytics',
      'track',
      'event',
      'funnel',
      'posthog',
      'measure usage',
    ],
  },
  {
    id: 'admin-analytics',
    name: 'Admin Analytics (charts and the analytics agent)',
    whatItIs:
      'The Analytics area’s charts, each registered with an AAQ id, served by /v1/analytics/* ' +
      'endpoints, plus the analytics agent that answers questions about the data.',
    reuseWhen:
      'A request wants a new chart, metric or dashboard for admins. Add a chart to the registry ' +
      'and an endpoint; do not build a separate dashboard page.',
    modules: [
      'ally-be:src/analytics',
      'ally-be:src/analytics-agent',
      'ally-be:src/analytics-suggestions',
    ],
    adminRoute: '/analytics',
    keywords: ['chart', 'dashboard', 'metric', 'report', 'analytics', 'kpi'],
  },
  {
    id: 'roleplay-sessions',
    name: 'Roleplay sessions, debriefs and session ratings',
    whatItIs:
      'Practice sessions (scenario_sessions), their end-of-session summary and debrief note, and ' +
      'the learner’s 1–5 session rating with tags (scenario_session_feedbacks), which rates the ' +
      'practice, not the debrief.',
    reuseWhen:
      'A request concerns what happens during or after a practice session, its score, its ' +
      'debrief, or learner feedback on a session. Showing a transcript in the reader’s ' +
      'language is already built (transcript-translation, cached per message).',
    modules: ['ally-be:src/learn', 'ally-be:src/transcript-translation'],
    keywords: [
      'roleplay',
      'session',
      'simulation',
      'debrief',
      'summary',
      'session rating',
      'feedback',
      'score',
    ],
  },
  {
    id: 'debrief-feedback',
    name: 'Debrief feedback (learner rating of the debrief)',
    whatItIs:
      'A learner’s thumbs-up or thumbs-down and optional comment on a roleplay’s debrief, one per ' +
      'session. When the debrief came from an Auto-improve experiment, the rating is written ' +
      'onto that output’s observation as its score (100 or 0) in place of the judge.',
    reuseWhen:
      'A request wants learner feedback on the debrief specifically, or human ratings feeding ' +
      'Auto-improve. The 1–5 session rating rates the practice and lives in learn.',
    modules: ['ally-be:src/debrief-feedback'],
    keywords: [
      'debrief rating',
      'debrief feedback',
      'thumbs up',
      'helpful',
      'rate the debrief',
    ],
  },
  {
    id: 'session-review',
    name: 'Session review (supervisor comments and reactions)',
    whatItIs:
      'Threads, comments, reactions and read status on a session, used by supervisors and ' +
      'reviewers: scenario-session-review for roleplay sessions, scribe-session-review for a ' +
      'counsellor’s Scribe sessions, both built on the shared bases in src/review.',
    reuseWhen:
      'A request wants people to comment on, review or react to a session, or an unread-review ' +
      'count. Extend the threads rather than adding a new comment store; a new kind of ' +
      'reviewable thing gets a sibling module on src/review.',
    modules: [
      'ally-be:src/scenario-session-review',
      'ally-be:src/scribe-session-review',
      'ally-be:src/review',
    ],
    keywords: ['review', 'comment', 'supervisor', 'reaction', 'thread'],
  },
  {
    id: 'helping-skills',
    name: 'Foundational helping skills (assessment and feedback mapping)',
    whatItIs:
      'Per-session assessment of the foundational helping skills by an LLM judge, benchmarks, ' +
      'human ratings, and the mapping from debrief feedback to the skills it named.',
    reuseWhen:
      'A request concerns skill scores, skill growth, or whether feedback named a skill.',
    modules: ['ally-be:src/foundational-skills'],
    docs: ['ally-be:docs/foundational-helping-skills.md'],
    keywords: ['skill', 'helping skills', 'competency', 'assessment', 'growth'],
  },
  {
    id: 'courses',
    name: 'Courses (Tracks)',
    whatItIs:
      'Courses built from components — quizzes, journals, annotations, games, media, roleplays — ' +
      'with enrolment, progress, localisation and cover images.',
    reuseWhen:
      'A request concerns learning content a learner works through in order, or a new kind of ' +
      'step inside a course. Add a component type rather than a new content system.',
    extendVia: 'Component templates (track-component-template.service.ts).',
    modules: ['ally-be:src/track'],
    keywords: [
      'course',
      'track',
      'lesson',
      'quiz',
      'journal',
      'module',
      'learning path',
    ],
  },
  {
    id: 'course-copilot',
    name: 'Course Copilot',
    whatItIs:
      'An agent that interviews a trainer and drafts or edits a course.',
    reuseWhen: 'A request wants AI help authoring or editing course content.',
    modules: ['ally-be:src/course-copilot'],
    docs: ['ally-be:docs/course-copilot.md'],
    adminRoute: '/course-copilot',
    keywords: ['course copilot', 'author course', 'generate course'],
  },
  {
    id: 'course-discussions',
    name: 'Course discussions',
    whatItIs: 'Per-lesson discussion threads inside a course.',
    reuseWhen:
      'A request wants learners or trainers to discuss or ask questions inside a course.',
    modules: ['ally-be:src/course-discussion'],
    docs: ['ally-be:docs/course-discussions.md'],
    keywords: ['discussion', 'question', 'forum', 'thread', 'ask trainer'],
  },
  {
    id: 'badges-xp',
    name: 'Badges, XP, streaks and the leaderboard',
    whatItIs:
      'Badge awards, streak milestones and per-tenant badge configuration; XP events (progress); ' +
      'and the community leaderboard, practice-streak heatmap and streak-at-risk reminders, fed ' +
      'by daily practice minutes recorded when a roleplay ends.',
    reuseWhen:
      'A request wants to reward, recognise or gamify learner activity, rank learners, or track ' +
      'practice streaks. New point sources belong in progress (XP events); award badges through ' +
      'the existing badge and milestone services.',
    modules: [
      'ally-be:src/badge',
      'ally-be:src/progress',
      'ally-be:src/community',
    ],
    adminRoute: '/user-badges',
    keywords: [
      'leaderboard',
      'rank',
      'badge',
      'xp',
      'streak',
      'reward',
      'gamification',
      'level',
      'leaderboard',
    ],
  },
  {
    id: 'feature-toggles',
    name: 'Admin feature toggles and permissions',
    whatItIs:
      'Every admin area sits behind a feature toggle (admin-feature-toggle.constants.ts) and ' +
      'permissions that union across a user’s roles.',
    reuseWhen:
      'A new admin surface or capability needs gating. Add a toggle and permissions; gate on ' +
      'roles[], never on the collapsed role.',
    modules: ['ally-be:src/authorization'],
    keywords: [
      'toggle',
      'permission',
      'gate',
      'access',
      'role',
      'feature flag',
    ],
  },
  {
    id: 'cohorts',
    name: 'Cohorts',
    whatItIs:
      'A tenant’s own grouping of its users, and per-cohort narrowing of content assigned to the ' +
      'tenant.',
    reuseWhen:
      'A request wants to target content or settings at a group of users within an org.',
    modules: ['ally-be:src/cohort'],
    keywords: ['cohort', 'group', 'segment', 'target users'],
  },
  {
    id: 'knowledge-base',
    name: 'Knowledge base (Weaviate corpora)',
    whatItIs:
      'Document corpora indexed for retrieval — the WhatsApp Q&A bot’s and the character ' +
      'library’s — with Postgres as the system of record and Weaviate per corpus.',
    reuseWhen:
      'A feature needs search or question answering over uploaded documents. Declare a corpus ' +
      'rather than building a second index.',
    modules: ['ally-be:src/knowledge-base'],
    keywords: [
      'knowledge base',
      'documents',
      'rag',
      'search docs',
      'retrieval',
      'corpus',
    ],
  },
  {
    id: 'dynamic-i18n',
    name: 'Dynamic i18n publishing',
    whatItIs:
      'Publishes translation bundles the apps load at runtime, so copy and translations change ' +
      'without an app release.',
    reuseWhen:
      'A request adds learner-facing copy that must be translated, or wants copy changed without ' +
      'a release.',
    modules: ['ally-be:src/dynamic-i18n'],
    docs: ['ally-be:docs/dynamic-i18n.md'],
    keywords: ['translation', 'i18n', 'language', 'copy', 'localise', 'hindi'],
  },
  {
    id: 'ai-lab',
    name: 'AI Lab',
    whatItIs:
      'A super-admin workspace for authoring reusable system prompts with variables and running ' +
      'them against models.',
    reuseWhen:
      'A request wants to try prompts against several models or inputs by hand.',
    modules: ['ally-be:src/lab'],
    adminRoute: '/ai-lab',
    keywords: ['ai lab', 'playground', 'try prompt', 'compare models'],
  },
  {
    id: 'image-generation',
    name: 'Image generation jobs',
    whatItIs:
      'Polled background jobs that generate images (course and scenario covers) with a model.',
    reuseWhen:
      'A feature needs a generated image. Reuse the job flow — long generations must be polled, ' +
      'not held open on a request.',
    modules: ['ally-be:src/image-generation'],
    keywords: ['image', 'cover', 'generate image', 'illustration'],
  },
  {
    id: 'bug-hunter',
    name: 'Bug Hunter',
    whatItIs:
      'A find-and-fix agent: sweeps for defects, records findings with a decision and dismissal ' +
      'reason, and opens fix PRs.',
    reuseWhen: 'A request concerns finding, triaging or auto-fixing bugs.',
    modules: ['ally-be:src/bug-hunter'],
    docs: ['ally-be:docs/bug-hunter-tools.md'],
    adminRoute: '/bug-hunter',
    keywords: ['bug', 'defect', 'finding', 'fix', 'triage'],
  },
  {
    id: 'ux-signals',
    name: 'UX signals',
    whatItIs:
      'Reads PostHog back through detectors (rage clicks, dead clicks, abandoned routes, empty ' +
      'searches, drop-off) and triages what it finds into Bug Hunter and Suggestions.',
    reuseWhen:
      'A request asks what users struggle with, or wants friction detected automatically.',
    modules: ['ally-be:src/ux-signals'],
    keywords: ['friction', 'rage click', 'drop-off', 'usability', 'ux'],
  },
  {
    id: 'product-roadmap',
    name: 'Product roadmap, votes and the opportunity copilot',
    whatItIs:
      'Roadmap opportunities with votes, the copilot that interviews someone into a filed ' +
      'opportunity, and the hand-off that opens a Builder session from one.',
    reuseWhen:
      'A request concerns filing, prioritising or voting on product work.',
    modules: ['ally-be:src/product-roadmap', 'ally-be:src/public-roadmap'],
    adminRoute: '/product-roadmap',
    keywords: [
      'roadmap',
      'opportunity',
      'vote',
      'prioritise',
      'feature request',
    ],
  },
  {
    id: 'builder',
    name: 'Builder',
    whatItIs:
      'The PRD interview and coding agent: interviews an admin into a PRD, drafts a technical ' +
      'design, then builds it and opens PRs.',
    reuseWhen:
      'A request concerns Builder itself, or turning a request into a PRD and a build.',
    modules: ['ally-be:src/builder'],
    adminRoute: '/builder',
    keywords: ['builder', 'prd', 'coding agent', 'build'],
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp bot',
    whatItIs:
      'The WhatsApp Q&A bot over a knowledge-base corpus, with number and identity gating.',
    reuseWhen:
      'A request wants to reach users on WhatsApp or answer questions there.',
    modules: ['ally-be:src/whatsapp'],
    adminRoute: '/whatsapp-bot',
    keywords: ['whatsapp', 'chat bot', 'messaging'],
  },
  {
    id: 'file-storage',
    name: 'File uploads (S3)',
    whatItIs: 'S3 access for uploads and generated files.',
    reuseWhen:
      'A feature stores a file a user uploads or the platform generates.',
    modules: ['ally-be:src/aws'],
    keywords: ['upload', 'file', 's3', 'attachment', 'media'],
  },
  {
    id: 'agent-memory',
    name: 'Agent memory (the agents’ notebook)',
    whatItIs:
      'A shared notebook where an internal AI agent keeps short lessons (600 characters each) so ' +
      'its next run does not rediscover them: searched by meaning, tidied hourly by a curator, ' +
      'and editable by admins who can add, retire and restore entries. Bug Hunter writes to it ' +
      'today.',
    reuseWhen:
      'An internal agent or copilot should remember what it learned last time, keep lessons or ' +
      'gotchas, or have a memory people can edit and retire. Do not build another memory table.',
    extendVia:
      'Add a value to AgentMemoryAgent (and its CHECK constraint); each agent exposes the ' +
      'endpoints on its own surface.',
    modules: ['ally-be:src/agent-memory'],
    docs: ['ally-be:docs/bug-hunter-memory-adr.md'],
    adminRoute: '/bug-hunter',
    keywords: [
      'agent memory',
      'notebook',
      'lessons learned',
      'remember',
      'gotcha',
    ],
  },
  {
    id: 'ally-ai-client',
    name: 'Calls to ally-ai and ally-ai-learn',
    whatItIs:
      'ally-be’s HTTP and SQS client for the AI services — summaries, nudges, transcription, ' +
      'scenario evaluation and reports, vector search — and the router for the events they send ' +
      'back.',
    reuseWhen:
      'A feature needs something ally-ai or ally-ai-learn already does. Call it through AiService ' +
      'rather than a second client.',
    extendVia:
      'Add the URL to ENDPOINTS and a method to AiService; inbound events get a processor ' +
      'registered in ProcessorRegistry.',
    modules: ['ally-be:src/ai'],
    keywords: [
      'ally-ai',
      'transcription',
      'summarise',
      'evaluation',
      'vector search',
    ],
  },
  {
    id: 'scribe',
    name: 'Scribe (counsellor session notes and call logs)',
    whatItIs:
      'A counsellor’s real client sessions, stored as chats: recorded live over the microphone ' +
      '(audio chunks uploaded to S3 encrypted), uploaded as a recording, or written as a note; ' +
      'transcribed, summarised by AI into a session note, and listed as call logs.',
    reuseWhen:
      'A request is about counsellors’ session notes, call or session logs, transcripts, AI ' +
      'session summaries, uploading a call recording or dictating a note. Not roleplay practice ' +
      '(learn) and not the text helpline.',
    modules: ['ally-be:src/chat', 'ally-be:src/audio'],
    docs: ['helloallytech.github.io:wiki/platform/scribe-summary-writes.md'],
    keywords: [
      'scribe',
      'session notes',
      'call logs',
      'transcript',
      'call recording',
      'dictation',
    ],
  },
  {
    id: 'cloud-telephony',
    name: 'Cloud telephony call ingest',
    whatItIs:
      'Brings calls in from a cloud telephony provider (Ozonetel today): per-org credentials, ' +
      'call-detail and call-event webhooks that create or end the chat and start transcription, ' +
      'and retries for missing recordings.',
    reuseWhen:
      'A request wants to connect a phone or call-centre provider, or have dialer call ' +
      'recordings transcribed and summarised.',
    extendVia:
      'Add a CloudTelephonyProvider value, a case in validateCredentials, and a provider service ' +
      'and webhook alongside Ozonetel’s.',
    modules: ['ally-be:src/audio-ingest'],
    keywords: ['telephony', 'ozonetel', 'call centre', 'dialer', 'phone calls'],
  },
  {
    id: 'custom-fields',
    name: 'Custom fields on Scribe session notes',
    whatItIs:
      'Per-tenant fields on a counsellor’s session notes (select, multi-select, date, text, ' +
      'number, boolean), each filled by hand, by AI from an instruction, or computed by the ' +
      'system, with control over editing, table columns and call-log filters.',
    reuseWhen:
      'A request wants a new field, column or filter on session notes or call logs, lets an org ' +
      'define its own note fields, or has AI fill a note field. Add a field, not a column.',
    extendVia:
      'A computed field is an entry in SYSTEM_FIELD_COMPUTERS; defaults live in the field ' +
      'templates constant.',
    modules: ['ally-be:src/custom-fields'],
    keywords: [
      'custom field',
      'note field',
      'session note template',
      'call log filter',
    ],
  },
  {
    id: 'text-helpline',
    name: 'Text helpline',
    whatItIs:
      'Live chat between anonymous members of the public and an org’s trained listeners: queue ' +
      'and lobby, claiming, a staff-only AI copilot, risk flags, supervisor monitoring, whisper ' +
      'and transfer, QA scoring, talker feedback and data erasure. Model output never reaches ' +
      'talkers.',
    reuseWhen:
      'A request involves live human-to-human support chat with the public, crisis or risk ' +
      'detection in those chats, the listener or supervisor workflow, or a new helpline channel.',
    extendVia:
      'The channel enum, the TEXT_HELPLINE_SETTINGS preference, per-tenant risk rules.',
    modules: ['ally-be:src/helpline'],
    docs: ['ally-be:docs/text-helpline.md'],
    keywords: [
      'helpline',
      'listener',
      'talker',
      'crisis chat',
      'risk flag',
      'live chat',
    ],
  },
  {
    id: 'languages',
    name: 'Languages and the language glossary',
    whatItIs:
      'The supported languages, each with its default LLM, STT and evaluation config, and the ' +
      'per-language glossary the live roleplay agent speaks from, maintained by an unattended ' +
      'loop (generate, consolidate, adjudicate, adherence reports).',
    reuseWhen:
      'A request adds or enables a language, changes the model or speech-to-text a language ' +
      'uses, or improves how the AI character speaks a language (register, dialect, colloquial ' +
      'words). Not content translation.',
    modules: ['ally-be:src/language'],
    docs: [
      'ally-be:docs/LANGUAGE_GLOSSARY_DESIGN.md',
      'ally-be:docs/language-glossary-v2-design.md',
    ],
    adminRoute: '/manage-scenario-languages',
    keywords: [
      'language',
      'glossary',
      'dialect',
      'hindi',
      'stt',
      'add language',
    ],
  },
  {
    id: 'roleplay-guardrails',
    name: 'Roleplay guardrails',
    whatItIs:
      'A global list pairing something a learner might say with how the AI character should ' +
      'respond, sampled into each roleplay for real-time boundary detection by the voice agent; ' +
      'platform guardrails (including the speech-coherence guard) are always on.',
    reuseWhen:
      'A request is about how the AI client reacts when a learner crosses a line, goes off-topic ' +
      'or speaks gibberish, or wants guardrails on or off for a roleplay. Add a guardrail row.',
    modules: ['ally-be:src/conversational-guardrails'],
    adminRoute: '/manage-guardrails',
    keywords: [
      'guardrail',
      'boundary',
      'off-topic',
      'inappropriate',
      'redirect',
    ],
  },
  {
    id: 'session-events',
    name: 'Session events (behaviour detection and scoring)',
    whatItIs:
      'The library of behaviours a roleplay detects while it runs — by similarity, time, score, ' +
      'combination or a binary classifier — each with a score, emoji, message, branch ' +
      'instruction, tags and translations, plus an AI Event Builder that drafts a detector.',
    reuseWhen:
      'A request wants to detect when the learner does something during a roleplay, add a ' +
      'scoring or feedback moment, or branch the conversation when something happens.',
    extendVia:
      'A new SessionEventDetectionType for new detection logic; mapping events to a scenario ' +
      'lives in learn.',
    modules: ['ally-be:src/session-event'],
    adminRoute: '/manage-events',
    keywords: [
      'session event',
      'detect',
      'behaviour',
      'scoring moment',
      'branch',
    ],
  },
  {
    id: 'character-library',
    name: 'Character Library',
    whatItIs:
      'Reusable client personas for roleplays — demographics, profile, a voice per language, ' +
      'language style, knowledge sources — owned by Ally or by one tenant, plus an AI character ' +
      'interview that drafts a character for review.',
    reuseWhen:
      'A request wants to create, edit or reuse a client persona, pick a character for a ' +
      'roleplay or course, or create characters with AI help.',
    modules: ['ally-be:src/scenario-character'],
    adminRoute: '/character-library',
    keywords: ['character', 'persona', 'client persona', 'character library'],
  },
  {
    id: 'roleplay-sequences',
    name: 'Cases and Pathways (sequences of roleplays)',
    whatItIs:
      'Two older ways to chain roleplays: Cases (2–20 roleplays where session memory carries ' +
      'forward and steps unlock in order) and Pathways (2–20 roleplays where the next unlocks ' +
      'after a minimum score). Both are assignable per tenant and translatable.',
    reuseWhen:
      'A request wants a multi-part roleplay or a story continuing across sessions (Cases), or ' +
      'roleplays that unlock in order behind a pass mark (Pathways). For a sequence mixing ' +
      'roleplays with quizzes, articles or video, use Courses (Tracks) instead.',
    modules: ['ally-be:src/case', 'ally-be:src/scenario-path'],
    keywords: [
      'case',
      'pathway',
      'series',
      'unlock',
      'sequence',
      'learning path',
    ],
  },
  {
    id: 'simulation-test-reports',
    name: 'Simulation test reports',
    whatItIs:
      'An automated test run of a roleplay: ally-ai-learn plays an N-turn conversation between a ' +
      'helper agent and the scenario (optionally a draft version), an evaluator scores the ' +
      'transcript, and the report streams live to the author.',
    reuseWhen:
      'A request wants to test or QA a simulation automatically before publishing, or run a bot ' +
      'against a roleplay and score it.',
    modules: ['ally-be:src/scenario-report'],
    keywords: [
      'test simulation',
      'qa roleplay',
      'evaluator',
      'test run',
      'report',
    ],
  },
  {
    id: 'roleplay-session-logs',
    name: 'Roleplay Logs',
    whatItIs:
      'A super-admin, read-only, all-organisation view of real learner roleplay sessions: list ' +
      'with score and cost, and a detail page with transcript, summary, scored events, latency, ' +
      'recording, lifecycle events, language judgements and weak metrics.',
    reuseWhen:
      'A request wants to see or debug a specific learner’s session, or add a diagnostic to a ' +
      'session’s detail page.',
    modules: ['ally-be:src/roleplay-session-logs'],
    adminRoute: '/roleplay-session-logs',
    keywords: [
      'session logs',
      'debug session',
      'session detail',
      'recording playback',
    ],
  },
  {
    id: 'roleplay-assets',
    name: 'Roleplay cover images and comfort audio',
    whatItIs:
      'Two shared, cross-tenant asset libraries for roleplay authoring: cover images (upload, ' +
      'URL, or AI-generated through image-generation jobs) and ambient comfort-audio tracks that ' +
      'authors pick for a roleplay.',
    reuseWhen:
      'A request wants authors to pick, upload or generate a cover image, or choose background ' +
      'or ambient sound for a roleplay. Reuse the libraries rather than storing assets per ' +
      'scenario.',
    modules: [
      'ally-be:src/scenario-cover-image-library',
      'ally-be:src/comfort-audio',
    ],
    keywords: [
      'cover image',
      'thumbnail',
      'image library',
      'comfort audio',
      'ambient sound',
    ],
  },
  {
    id: 'voices',
    name: 'Roleplay voices and voice preview',
    whatItIs:
      'Plays a short sample of a configured roleplay voice through its text-to-speech provider ' +
      'so an admin can hear it before choosing it; voice configuration itself lives in learn.',
    reuseWhen:
      'A request wants to hear, audition or compare voices, or preview a voice in a language.',
    extendVia:
      'A new TTS vendor is one ITTSProvider class plus a case in TTSProviderFactory.',
    modules: ['ally-be:src/voice-preview'],
    adminRoute: '/manage-scenario-voices',
    keywords: ['voice', 'tts', 'text to speech', 'voice preview', 'audition'],
  },
  {
    id: 'live-voice-rooms',
    name: 'Live voice rooms (LiveKit)',
    whatItIs:
      'The backend’s only LiveKit wrapper: rooms, access tokens, dispatching the AI agent into a ' +
      'room, recordings, and room events turned into roleplay session lifecycle updates.',
    reuseWhen:
      'A feature needs real-time voice or video, a recording, or the AI agent in a call. Go ' +
      'through LiveKitService rather than a new SDK client.',
    modules: ['ally-be:src/livekit'],
    keywords: ['livekit', 'voice call', 'room', 'recording', 'real-time voice'],
  },
  {
    id: 'model-test',
    name: 'Model test (LLM preview)',
    whatItIs:
      'The admin “test this model” check: one fixed prompt to a catalog model, returning the ' +
      'reply, latency and tokens, or the provider’s own error.',
    reuseWhen:
      'A request wants to check that a model still works or test one before saving it.',
    modules: ['ally-be:src/llm-preview'],
    adminRoute: '/manage-llm-model-catalog',
    keywords: ['test model', 'model health', 'llm preview', 'model catalog'],
  },
  {
    id: 'mobile-releases',
    name: 'Mobile releases',
    whatItIs:
      'A super-admin console for the ally-mobile release pipeline: workflow runs, TestFlight, ' +
      'App Store review and Play status, promoting Android, AI-drafted “What’s New” text, and an ' +
      'automatic minimum-version bump once a build is live.',
    reuseWhen:
      'A request is about releasing the app, store review status, release notes for the stores, ' +
      'or forcing users to update.',
    modules: ['ally-be:src/mobile-releases'],
    adminRoute: '/mobile-releases',
    keywords: [
      'mobile release',
      'testflight',
      'app store',
      'play store',
      'force update',
    ],
  },
  {
    id: 'product-updates',
    name: 'Product updates and the public changelog',
    whatItIs:
      'The public changelog read from the ally-changelog file, and product updates built from ' +
      'it: merges grouped by an LLM into one recognisable change, published once every part is ' +
      'live, with a daily digest email and admin corrections that the job never overwrites.',
    reuseWhen:
      'A request wants “what’s new”, release notes, a shipped-features feed, or the team told ' +
      'what went live.',
    modules: ['ally-be:src/product-updates', 'ally-be:src/changelog'],
    adminRoute: '/product-updates',
    keywords: [
      'changelog',
      'release notes',
      'what’s new',
      'shipped',
      'product updates',
    ],
  },
  {
    id: 'blog',
    name: 'Blog',
    whatItIs:
      'Platform-wide posts written by super-admins — draft and published, slug, tags, header ' +
      'image, sanitised HTML — shown publicly without login at /blog.',
    reuseWhen:
      'A request wants an announcement post, a public article or a news page.',
    modules: ['ally-be:src/blog'],
    adminRoute: '/blog',
    keywords: ['blog', 'post', 'article', 'announcement'],
  },
  {
    id: 'reference-documents',
    name: 'Reference documents (counsellor resource library)',
    whatItIs:
      'Searchable reference articles (heading, content, category, tags), public or per ' +
      'organisation, uploaded by CSV and searched through ally-ai’s vector store; counsellors ' +
      'use it from the helpline dashboard and the mobile app.',
    reuseWhen:
      'A request wants counsellors to search guidance or articles, or a resource library by ' +
      'category. For a new document-search feature, extend the knowledge base instead.',
    modules: ['ally-be:src/reference-document'],
    keywords: [
      'reference document',
      'resource library',
      'article search',
      'guidance',
    ],
  },
  {
    id: 'places',
    name: 'Places (city and state lookup)',
    whatItIs: 'A reference list of cities and states with type-ahead search.',
    reuseWhen:
      'A request needs a location picker or city autocomplete. Reuse it rather than adding a ' +
      'second location list.',
    modules: ['ally-be:src/place'],
    keywords: ['city', 'state', 'location', 'place', 'autocomplete'],
  },
  {
    id: 'tooltips',
    name: 'Tooltips (editable help text)',
    whatItIs:
      'Help-text tooltips a superadmin edits by location key, machine-translated into each ' +
      'language and fetched by any frontend without login.',
    reuseWhen:
      'A request wants to change help text or an info icon on a screen without a deploy.',
    modules: ['ally-be:src/tooltip'],
    adminRoute: '/manage-tooltips',
    keywords: ['tooltip', 'help text', 'info icon', 'hint'],
  },
  {
    id: 'github-client',
    name: 'GitHub client',
    whatItIs:
      'The platform’s GitHub REST client: workflow dispatch and runs, pull requests, checks, ' +
      'reviews, issues, commits and release tags.',
    reuseWhen:
      'Any backend feature that talks to GitHub injects GithubActionsService rather than ' +
      'writing its own client.',
    modules: ['ally-be:src/github'],
    keywords: ['github', 'workflow', 'pull request', 'release tag'],
  },
];

/**
 * ally-be modules no capability needs to cover: plumbing every feature already
 * sits on, which no request would ask to reuse by name. The coverage spec lists
 * any module that is neither covered nor here, so a new feature module shows up
 * as a gap rather than silently staying out of the map.
 */
export const BUILDER_CAPABILITY_EXEMPT_MODULES: ReadonlySet<string> = new Set([
  'app-version',
  'audit',
  'auth',
  'common',
  'config',
  'database',
  'health',
  'logs',
  'message-broker',
  'queue',
  'rate-limit',
  'redis',
  'release',
  'settings',
  'user',
  'tenant',
]);
