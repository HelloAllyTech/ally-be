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
 * (a warning for now, not a failure — see `BUILDER_CAPABILITY_EXEMPT_MODULES`).
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
      'rubric; the judge score is the only signal today — a human rating would be a new input.',
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
      'never construct a provider SDK client directly.',
    modules: ['ally-be:src/llm-agent'],
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
      'debrief, or learner feedback on a session.',
    modules: ['ally-be:src/learn'],
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
    id: 'session-review',
    name: 'Session review (supervisor comments and reactions)',
    whatItIs:
      'Threads, comments and reactions on a learner’s session, used by supervisors and reviewers.',
    reuseWhen:
      'A request wants people to comment on, review or react to a session. Extend the threads ' +
      'rather than adding a new comment store.',
    modules: ['ally-be:src/scenario-session-review'],
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
    name: 'Badges, streaks and XP',
    whatItIs:
      'Badge awards, streak milestones and per-tenant badge configuration.',
    reuseWhen:
      'A request wants to reward, recognise or gamify learner activity. Award through the ' +
      'existing badge and milestone services.',
    modules: ['ally-be:src/badge', 'ally-be:src/progress'],
    adminRoute: '/user-badges',
    keywords: [
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
