import { MigrationInterface, QueryRunner } from 'typeorm';

const PERMISSIONS: Record<string, string> = {
  // === USER MANAGEMENT ===
  EDIT_USER: 'edit:user',
  EDIT_USER_ROLE: 'edit:user:role',

  // === CHAT MANAGEMENT ===
  VIEW_CHAT: 'view:chat',
  EDIT_CHAT: 'edit:chat',
  VIEW_CHAT_COUNSELOR: 'view:chat:counselor',
  VIEW_CHAT_DETAILS: 'view:chat:details',
  EDIT_CHAT_NOTE: 'edit:chat:note',
  DELETE_CHAT: 'delete:chat',

  // === CALL MANAGEMENT ===
  VIEW_CALL_LOGS: 'view:call:logs',
  VIEW_CALL_LOGS_SUMMARY: 'view:call:logs-summary',
  EDIT_CALL_DETAILS: 'edit:call:details',
  EDIT_CALL_INFO: 'edit:call:info',

  // Call action permissions (role-specific)
  EDIT_CALL_START: 'edit:call:start',
  EDIT_CALL_ACCEPT: 'edit:call:accept',
  EDIT_CALL_END: 'edit:call:end',

  // === MESSAGE MANAGEMENT ===
  VIEW_MESSAGE: 'view:message',
  VIEW_MESSAGE_FEEDBACK: 'view:message:feedback',
  EDIT_MESSAGE_FEEDBACK: 'edit:message:feedback',

  // === SUMMARY MANAGEMENT ===
  VIEW_SUMMARY: 'view:summary',
  EDIT_SUMMARY: 'edit:summary',
  EXPORT_SUMMARY: 'export:summary', // already present
  EDIT_SUMMARY_FEEDBACK: 'edit:summary:feedback',

  // === ANALYTICS ===
  EDIT_ANALYTICS_DASHBOARD: 'edit:analytics:dashboard',
  VIEW_ANALYTICS_DASHBOARD_URL: 'view:analytics:dashboard-url',
  VIEW_ANALYTICS_DASHBOARD: 'view:analytics:dashboard',

  // === LEARNING MODULE ===
  EDIT_SCENARIO: 'edit:scenario',
  VIEW_SCENARIO_SESSION: 'view:scenario-session',
  EDIT_SCENARIO_SESSION: 'edit:scenario-session',
  VIEW_ADMIN_SCENARIO_SESSION: 'view:admin:scenario-session',
  VIEW_SCENARIO_SESSION_DETAILS: 'view:scenario-session:details',
  EDIT_SCENARIO_MAP_EVENTS: 'edit:scenario-session:map-events',
  VIEW_SESSION_SCENARIO_MESSAGES: 'view:session-scenario:messages',
  VIEW_SESSION_SCENARIO_SUMMARY: 'view:scenario-session:summary',

  // === SETTINGS ===
  VIEW_SETTINGS_SUMMARY_FIELDS: 'view:settings:summary-fields',
  EDIT_SETTINGS_SUMMARY_FIELDS: 'edit:settings:summary-fields',
  VIEW_SETTINGS_NUDGE_STATUS: 'view:settings:nudge-status',
  EDIT_SETTINGS_NUDGE_STATUS: 'edit:settings:nudge-status',
  VIEW_SETTINGS_CHAT_TYPES: 'view:settings:chat-types',
  EDIT_SETTINGS_CHAT_TYPES: 'edit:settings:chat-types',

  // === TENANT MANAGEMENT ===
  VIEW_TENANT: 'view:tenant',
  EDIT_TENANT: 'edit:tenant',

  // === REFERENCE DOCUMENTS ===
  VIEW_REFERENCE_DOCUMENT: 'view:reference-document',
  EDIT_REFERENCE_DOCUMENT: 'edit:reference-document',
  DELETE_REFERENCE_DOCUMENT: 'delete:reference-document',
  UPLOAD_REFERENCE_DOCUMENT: 'upload:reference-document',
  UPDATE_REFERENCE_DOCUMENT_ARCHIVE: 'edit:reference-document:archive',

  // === LIVEKIT ===
  VIEW_LIVEKIT: 'view:livekit',
  EDIT_LIVEKIT: 'edit:livekit',

  // === SESSION EVENTS ===
  EDIT_SESSION_EVENTS: 'edit:session-events',

  // === MISC ENTITIES ===
  VIEW_COUNSELOR: 'view:counselor',
  VIEW_TAGS: 'view:tags',
  EDIT_ENHANCEMENT: 'edit:enhancement',
  VIEW_CHAT_NUDGE: 'view:chat:nudge',
  EDIT_TAG_POSITIVITY_RATINGS: 'edit:tag-positivity-ratings',

  // === CLOUD TELEPHONY ===
  EDIT_CLOUD_TELEPHONY: 'edit:cloud-telephony',

  // UI Specific Permissions
  VIEW_ANALYTICS: 'view:analytics',
  VIEW_COMMUNITY: 'view:community',

  // === OZONETEL ===
  SUBSCRIBE_OZONETEL_EVENTS: 'subscribe:ozonetel:events',
  UNSUBSCRIBE_OZONETEL_EVENTS: 'unsubscribe:ozonetel:events',

  // AUDIO UPLOAD
  VIEW_AUDIO_UPLOAD: 'view:audio-upload-url',
  CANCEL_AUDIO_UPLOAD: 'cancel:audio-upload',
};

const SUPER_ADMIN_PERMISSIONS = [
  // Full administrative access
  PERMISSIONS.EDIT_USER,
  PERMISSIONS.EDIT_USER_ROLE,
  PERMISSIONS.VIEW_CALL_LOGS,
  PERMISSIONS.EXPORT_SUMMARY,
  PERMISSIONS.EDIT_SCENARIO,
  PERMISSIONS.EDIT_SCENARIO_MAP_EVENTS,
  PERMISSIONS.VIEW_SETTINGS_SUMMARY_FIELDS,
  PERMISSIONS.EDIT_REFERENCE_DOCUMENT,
  PERMISSIONS.UPDATE_REFERENCE_DOCUMENT_ARCHIVE,
  PERMISSIONS.VIEW_TENANT,
  PERMISSIONS.EDIT_TENANT,
  PERMISSIONS.DELETE_REFERENCE_DOCUMENT,
  PERMISSIONS.UPLOAD_REFERENCE_DOCUMENT,
  PERMISSIONS.VIEW_LIVEKIT,
  PERMISSIONS.EDIT_LIVEKIT,
  PERMISSIONS.EDIT_SESSION_EVENTS,
  PERMISSIONS.VIEW_SETTINGS_CHAT_TYPES,
  PERMISSIONS.EDIT_CLOUD_TELEPHONY,
  PERMISSIONS.SUBSCRIBE_OZONETEL_EVENTS,
  PERMISSIONS.UNSUBSCRIBE_OZONETEL_EVENTS,
];

const COUNSELOR_PERMISSIONS = [
  // Core counselor functions
  PERMISSIONS.VIEW_CHAT,
  PERMISSIONS.VIEW_CHAT_COUNSELOR,
  PERMISSIONS.VIEW_CHAT_DETAILS,
  PERMISSIONS.EDIT_CHAT_NOTE,
  PERMISSIONS.VIEW_CALL_LOGS,
  PERMISSIONS.EDIT_CALL_DETAILS,
  PERMISSIONS.EDIT_CALL_INFO,
  PERMISSIONS.EDIT_CALL_START,
  PERMISSIONS.EDIT_CALL_ACCEPT,
  PERMISSIONS.EDIT_CALL_END,
  PERMISSIONS.VIEW_REFERENCE_DOCUMENT,
  PERMISSIONS.VIEW_MESSAGE,
  PERMISSIONS.VIEW_MESSAGE_FEEDBACK,
  PERMISSIONS.EDIT_MESSAGE_FEEDBACK,
  PERMISSIONS.VIEW_SUMMARY,
  PERMISSIONS.EDIT_SUMMARY, // old
  PERMISSIONS.EXPORT_SUMMARY,
  PERMISSIONS.EDIT_SUMMARY_FEEDBACK,
  PERMISSIONS.VIEW_SETTINGS_SUMMARY_FIELDS,
  PERMISSIONS.EDIT_SETTINGS_SUMMARY_FIELDS,
  PERMISSIONS.VIEW_SETTINGS_NUDGE_STATUS,
  PERMISSIONS.EDIT_SETTINGS_NUDGE_STATUS,
  PERMISSIONS.VIEW_SETTINGS_CHAT_TYPES,
  PERMISSIONS.EDIT_ENHANCEMENT,
  PERMISSIONS.VIEW_CHAT_NUDGE,
  PERMISSIONS.EDIT_TAG_POSITIVITY_RATINGS,

  PERMISSIONS.VIEW_ANALYTICS,
  PERMISSIONS.VIEW_COMMUNITY,
  PERMISSIONS.VIEW_ANALYTICS_DASHBOARD_URL,
  PERMISSIONS.VIEW_ANALYTICS_DASHBOARD,
];

const ADMIN_PERMISSIONS = [
  // Administrative access to core features
  PERMISSIONS.VIEW_CHAT_DETAILS,
  PERMISSIONS.VIEW_CALL_LOGS,
  PERMISSIONS.VIEW_CALL_LOGS_SUMMARY,
  PERMISSIONS.EDIT_CALL_DETAILS,
  PERMISSIONS.EDIT_CALL_INFO,
  PERMISSIONS.VIEW_MESSAGE,
  PERMISSIONS.EXPORT_SUMMARY,
  PERMISSIONS.EDIT_ANALYTICS_DASHBOARD,
  PERMISSIONS.VIEW_ADMIN_SCENARIO_SESSION,
  PERMISSIONS.VIEW_SCENARIO_SESSION_DETAILS,
  PERMISSIONS.VIEW_SESSION_SCENARIO_MESSAGES,
  PERMISSIONS.VIEW_SETTINGS_SUMMARY_FIELDS,
  PERMISSIONS.EDIT_SETTINGS_SUMMARY_FIELDS,
  PERMISSIONS.VIEW_SETTINGS_NUDGE_STATUS,
  PERMISSIONS.EDIT_SETTINGS_NUDGE_STATUS,
  PERMISSIONS.VIEW_SETTINGS_CHAT_TYPES,
  PERMISSIONS.EDIT_SETTINGS_CHAT_TYPES,
  PERMISSIONS.VIEW_COUNSELOR,
  PERMISSIONS.VIEW_TAGS,
  PERMISSIONS.EDIT_TAG_POSITIVITY_RATINGS,
  PERMISSIONS.EDIT_REFERENCE_DOCUMENT,

  PERMISSIONS.VIEW_ANALYTICS,
  PERMISSIONS.VIEW_COMMUNITY,
  PERMISSIONS.VIEW_AUDIO_UPLOAD,
  PERMISSIONS.CANCEL_AUDIO_UPLOAD,
  PERMISSIONS.DELETE_CHAT,
  PERMISSIONS.VIEW_ANALYTICS_DASHBOARD_URL,
  PERMISSIONS.VIEW_ANALYTICS_DASHBOARD,
];

const LEARNER_PERMISSIONS = [
  // Learning focused permissions
  PERMISSIONS.VIEW_SCENARIO_SESSION,
  PERMISSIONS.EDIT_SCENARIO_SESSION,
  PERMISSIONS.VIEW_SCENARIO_SESSION_DETAILS,
  PERMISSIONS.VIEW_SESSION_SCENARIO_MESSAGES,

  PERMISSIONS.VIEW_ANALYTICS,
  PERMISSIONS.VIEW_ANALYTICS_DASHBOARD,
  PERMISSIONS.VIEW_ANALYTICS_DASHBOARD_URL,
];

const CLIENT_PERMISSIONS = [
  // Basic client functions
  PERMISSIONS.VIEW_CHAT,
  PERMISSIONS.EDIT_CHAT,
  PERMISSIONS.EDIT_CALL_END,
];

export enum UserRole {
  CLIENT = 'CLIENT',
  COUNSELOR = 'COUNSELOR',
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  LEARNER = 'LEARNER',
}

export class UpdatePermissions1758620201178 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Insert all permissions from PERMISSIONS constant (only missing ones)
    const permissionValues = Object.values(PERMISSIONS);

    for (const permissionName of permissionValues) {
      // Check if permission already exists
      const existingPermission = await queryRunner.query(
        `SELECT id FROM "permissions" WHERE name = $1`,
        [permissionName],
      );

      // Only insert if it doesn't exist
      if (existingPermission.length === 0) {
        await queryRunner.query(
          `INSERT INTO "permissions" (name) VALUES ($1)`,
          [permissionName],
        );
      }
    }

    // 2. Get all existing group IDs
    const roleGroups = Object.values(UserRole);
    const groups = await queryRunner.query(
      `
            SELECT id, name FROM "groups" WHERE name IN (${roleGroups
              .map((_, index) => `$${index + 1}`)
              .join(',')})
        `,
      roleGroups,
    );

    const groupMap = groups.reduce(
      (acc: Record<string, number>, group: { id: number; name: string }) => {
        acc[group.name] = group.id;
        return acc;
      },
      {},
    );

    // 3. Get all permission IDs
    const permissions = await queryRunner.query(
      `
            SELECT id, name FROM "permissions" WHERE name IN (${permissionValues
              .map((_, index) => `$${index + 1}`)
              .join(',')})
        `,
      permissionValues,
    );

    const permissionMap = permissions.reduce(
      (
        acc: Record<string, number>,
        permission: { id: number; name: string },
      ) => {
        acc[permission.name] = permission.id;
        return acc;
      },
      {},
    );

    // 4. Assign permissions to groups based on role-specific arrays (only missing ones)
    const rolePermissionMappings = [
      { role: UserRole.SUPER_ADMIN, permissions: SUPER_ADMIN_PERMISSIONS },
      { role: UserRole.COUNSELOR, permissions: COUNSELOR_PERMISSIONS },
      { role: UserRole.ADMIN, permissions: ADMIN_PERMISSIONS },
      { role: UserRole.LEARNER, permissions: LEARNER_PERMISSIONS },
      { role: UserRole.CLIENT, permissions: CLIENT_PERMISSIONS },
    ];

    for (const mapping of rolePermissionMappings) {
      const groupId = groupMap[mapping.role];
      if (!groupId) continue;

      for (const permissionName of mapping.permissions) {
        const permissionId = permissionMap[permissionName];
        if (!permissionId) continue;

        // Check if the group permission already exists
        const existingGroupPermission = await queryRunner.query(
          `SELECT id FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
          [groupId, permissionId],
        );

        // Only insert if it doesn't exist
        if (existingGroupPermission.length === 0) {
          await queryRunner.query(
            `INSERT INTO group_permissions ("groupId", "permissionId") VALUES ($1, $2)`,
            [groupId, permissionId],
          );
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove only the permissions that were added by this migration
    const permissionValues = Object.values(PERMISSIONS);
    await queryRunner.query(
      `DELETE FROM group_permissions WHERE "permissionId" IN (
        SELECT id FROM "permissions" WHERE name IN (${permissionValues.map((_, index) => `$${index + 1}`).join(',')})
      )`,
      permissionValues,
    );

    await queryRunner.query(
      `DELETE FROM "permissions" WHERE name IN (${permissionValues.map((_, index) => `$${index + 1}`).join(',')})`,
      permissionValues,
    );
  }
}
