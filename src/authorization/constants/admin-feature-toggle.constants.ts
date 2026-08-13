/**
 * Registry of per-admin-user feature toggles that gate the surfaces formerly
 * split across SUPER_ADMIN / SUPER_DUPER_ADMIN / MULTI_TENANT_ADMIN.
 *
 * This is the single source of truth for "which of the old tiers granted this
 * capability" — the role-collapse migration (see
 * src/database/migrations/*-CreatePlatformAdminRole.ts) reads `legacyGrants`
 * to backfill exact per-user toggle state at cutover, and
 * FeatureToggleGuard/@RequireFeatureToggle reads `key` to enforce it going
 * forward. Add a new key here — nowhere else — when a new admin-tier
 * capability is introduced; ally-web fetches this list via
 * GET /v1/authorization/feature-toggles/registry rather than keeping a second,
 * hand-mirrored copy (the drift the old SUPER_DUPER_ADMIN_ROLES/ally-web
 * mirror comment already flags).
 */
export enum FeatureToggleKey {
  // Content & simulation config (formerly SUPER_ADMIN-tier)
  MANAGE_SCENARIO_LANGUAGES = 'manage_scenario_languages',
  AI_LAB = 'ai_lab',
  COMPETENCIES = 'competencies',
  ROLEPLAY_SESSION_LOGS = 'roleplay_session_logs',
  ORG_DETAIL_CONTENT_TABS = 'org_detail_content_tabs',

  // Analytics (route itself is SUPER_ADMIN-tier; two sub-tabs are SDA-only)
  ANALYTICS = 'analytics',
  ANALYTICS_AGENT = 'analytics_agent',
  ANALYTICS_SUGGESTIONS = 'analytics_suggestions',

  // Platform config (formerly SUPER_DUPER_ADMIN-only)
  USER_BADGES = 'user_badges',
  CHARACTER_LIBRARY = 'character_library',
  MANAGE_STT_CONFIGS = 'manage_stt_configs',
  MANAGE_LLM_MODEL_CATALOG = 'manage_llm_model_catalog',
  MANAGE_GUARDRAILS = 'manage_guardrails',
  MANAGE_TOOLTIPS = 'manage_tooltips',
  SETTINGS = 'settings',
  // Also gates the backend's VIEW_AWS_LOGS permission — one feature, one key.
  LOGS = 'logs',
  AGENT_TEST_CASES = 'agent_test_cases',

  // WhatsApp Q&A bot (formerly SUPER_DUPER_ADMIN-only)
  WHATSAPP_BOT = 'whatsapp_bot',

  // Knowledge base backing the WhatsApp bot (formerly SUPER_DUPER_ADMIN-only)
  KNOWLEDGE_BASE = 'knowledge_base',

  // Product Roadmap management surface (view/vote stay permission-gated for
  // everyone; only the manage surface was SDA-exclusive)
  PRODUCT_ROADMAP_MANAGE = 'product_roadmap_manage',

  // Admin-of-admins surfaces (formerly SUPER_DUPER_ADMIN-only)
  ADMIN_USER_MANAGEMENT = 'admin_user_management',
  MULTI_TENANT_ALLOWLIST_MANAGEMENT = 'multi_tenant_allowlist_management',

  // Bug Hunter: the autonomous find-and-fix agent (formerly SUPER_DUPER_ADMIN-only)
  BUG_HUNTER = 'bug_hunter',

  // Operational, all-scenarios/all-sessions bulk actions (translate-passive,
  // checklist-item translation, V2V test sessions) — historically gated to
  // SUPER_ADMIN-tier specifically so MULTI_TENANT_ADMIN, who holds the
  // underlying CRUD permission for library content, cannot trigger them.
  OPERATIONAL_ADMIN_ACTIONS = 'operational_admin_actions',
}

export interface FeatureToggleLegacyGrants {
  superAdmin: boolean;
  superDuperAdmin: boolean;
  multiTenantAdmin: boolean;
}

export interface FeatureToggleDefinition {
  key: FeatureToggleKey;
  label: string;
  description: string;
  legacyGrants: FeatureToggleLegacyGrants;
}

const SDA_ONLY: FeatureToggleLegacyGrants = {
  superAdmin: false,
  superDuperAdmin: true,
  multiTenantAdmin: false,
};

const SUPER_ADMIN_TIER: FeatureToggleLegacyGrants = {
  superAdmin: true,
  superDuperAdmin: true,
  multiTenantAdmin: false,
};

export const FEATURE_TOGGLES: FeatureToggleDefinition[] = [
  {
    key: FeatureToggleKey.MANAGE_SCENARIO_LANGUAGES,
    label: 'Scenario Languages',
    description:
      'Manage scenario language configuration and the language glossary.',
    legacyGrants: SUPER_ADMIN_TIER,
  },
  {
    key: FeatureToggleKey.AI_LAB,
    label: 'AI Lab',
    description: 'Access the AI Lab experimentation tables.',
    legacyGrants: SUPER_ADMIN_TIER,
  },
  {
    key: FeatureToggleKey.COMPETENCIES,
    label: 'Competencies',
    description: 'Manage the competency taxonomy used by evaluations.',
    legacyGrants: SUPER_ADMIN_TIER,
  },
  {
    key: FeatureToggleKey.ROLEPLAY_SESSION_LOGS,
    label: 'Roleplay Session Logs',
    description: 'View roleplay session logs and their detail pages.',
    legacyGrants: SUPER_ADMIN_TIER,
  },
  {
    key: FeatureToggleKey.ORG_DETAIL_CONTENT_TABS,
    label: 'Org Detail — Content Tabs',
    description:
      'Path, Cases and Courses (Track 2.0) tabs inside an organization’s detail page.',
    legacyGrants: SUPER_ADMIN_TIER,
  },
  {
    key: FeatureToggleKey.ANALYTICS,
    label: 'Analytics',
    description: 'Access the Analytics tab and its general sub-tabs.',
    legacyGrants: SUPER_ADMIN_TIER,
  },
  {
    key: FeatureToggleKey.ANALYTICS_AGENT,
    label: 'Analytics — Agent',
    description:
      'The Analytics Agent sub-tab, on top of general Analytics access.',
    legacyGrants: SDA_ONLY,
  },
  {
    key: FeatureToggleKey.ANALYTICS_SUGGESTIONS,
    label: 'Analytics — Suggestions',
    description:
      'The Analytics Suggestions sub-tab, on top of general Analytics access.',
    legacyGrants: SDA_ONLY,
  },
  {
    key: FeatureToggleKey.USER_BADGES,
    label: 'User Badges',
    description: 'Manage the global user badge catalog.',
    legacyGrants: SDA_ONLY,
  },
  {
    key: FeatureToggleKey.CHARACTER_LIBRARY,
    label: 'Character Library',
    description: 'Manage the shared scenario character library.',
    legacyGrants: SDA_ONLY,
  },
  {
    key: FeatureToggleKey.MANAGE_STT_CONFIGS,
    label: 'Speech Recognition',
    description: 'Manage speech-to-text provider configuration.',
    legacyGrants: SDA_ONLY,
  },
  {
    key: FeatureToggleKey.MANAGE_LLM_MODEL_CATALOG,
    label: 'Language Model Catalog',
    description: 'Manage the LLM model catalog available to scenarios.',
    legacyGrants: SDA_ONLY,
  },
  {
    key: FeatureToggleKey.MANAGE_GUARDRAILS,
    label: 'Guardrails',
    description: 'Manage content-safety guardrail configuration.',
    legacyGrants: SDA_ONLY,
  },
  {
    key: FeatureToggleKey.MANAGE_TOOLTIPS,
    label: 'Tooltips',
    description: 'Manage the in-app tooltip CMS content.',
    legacyGrants: SDA_ONLY,
  },
  {
    key: FeatureToggleKey.SETTINGS,
    label: 'Settings',
    description: 'Access the global platform settings page.',
    legacyGrants: SDA_ONLY,
  },
  {
    key: FeatureToggleKey.LOGS,
    label: 'Logs',
    description: 'View AWS CloudWatch application logs.',
    legacyGrants: SDA_ONLY,
  },
  {
    key: FeatureToggleKey.AGENT_TEST_CASES,
    label: 'Agent Test Cases',
    description: 'Manage roleplay agent test cases and rubrics.',
    legacyGrants: SDA_ONLY,
  },
  {
    key: FeatureToggleKey.WHATSAPP_BOT,
    label: 'WhatsApp Bot',
    description:
      'Manage the WhatsApp Q&A bot: templates, conversations, unanswered queue and analytics.',
    legacyGrants: SDA_ONLY,
  },
  {
    key: FeatureToggleKey.KNOWLEDGE_BASE,
    label: 'Knowledge Base',
    description:
      'View, edit, upload and archive documents in the WhatsApp bot’s knowledge base.',
    legacyGrants: SDA_ONLY,
  },
  {
    key: FeatureToggleKey.PRODUCT_ROADMAP_MANAGE,
    label: 'Product Roadmap — Manage',
    description:
      'Stage transitions, editing/deleting any opportunity, taxonomy, split/merge and release notes. Viewing and voting stay open to every admin.',
    legacyGrants: SDA_ONLY,
  },
  {
    key: FeatureToggleKey.ADMIN_USER_MANAGEMENT,
    label: 'Admin User Management',
    description:
      'Assign/remove the platform admin role and edit other admins’ feature toggles. Holding this is required to change anyone’s toggles, including your own.',
    legacyGrants: SDA_ONLY,
  },
  {
    key: FeatureToggleKey.MULTI_TENANT_ALLOWLIST_MANAGEMENT,
    label: 'Tenant Allowlist Management',
    description:
      'Restrict a platform admin to a specific set of tenants (or clear the restriction).',
    legacyGrants: SDA_ONLY,
  },
  {
    key: FeatureToggleKey.BUG_HUNTER,
    label: 'Bug Hunter',
    description:
      'Configure and run the autonomous find-and-fix agent, and review its run history.',
    legacyGrants: SDA_ONLY,
  },
  {
    key: FeatureToggleKey.OPERATIONAL_ADMIN_ACTIONS,
    label: 'Operational Admin Actions',
    description:
      'Bulk/operational actions that act across every tenant (translation backfills, V2V test sessions) — deliberately excluded from tenant-restricted admins.',
    legacyGrants: SUPER_ADMIN_TIER,
  },
];

export const FEATURE_TOGGLE_KEYS: FeatureToggleKey[] = FEATURE_TOGGLES.map(
  (definition) => definition.key,
);

export function isValidFeatureToggleKey(key: string): key is FeatureToggleKey {
  return FEATURE_TOGGLE_KEYS.includes(key as FeatureToggleKey);
}
