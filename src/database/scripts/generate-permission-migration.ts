/**
 * generate-permission-migration.ts
 *
 * Automatically generates a TypeORM migration file for any new permissions
 * defined in `permissions.constants.ts` that are not yet present in existing
 * migration files.
 *
 * Usage:
 *   npm run migration:permissions --name=<MigrationName>
 *
 * Example:
 *   npm run migration:permissions --name=addReportingPermissions
 *
 * How it works:
 *  1. Parses `src/authorization/constants/permissions.constants.ts` to extract
 *     every permission value and which role groups it belongs to.
 *  2. Scans every file under `src/database/migrations/` and collects all
 *     permission strings that are already referenced there.
 *  3. Computes the diff — permissions present in the constants file but absent
 *     from all existing migrations.
 *  4. Writes a new migration file that:
 *       - INSERTs the new permissions into the `permissions` table (idempotent).
 *       - INSERTs the appropriate `group_permissions` rows.
 *       - Provides a `down()` that cleans up both tables.
 */

import * as fs from 'fs';
import * as path from 'path';
import { UserRole } from 'src/common/constants/user.constants';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const PERMISSIONS_CONSTANTS_PATH = path.join(
  PROJECT_ROOT,
  'src/authorization/constants/permissions.constants.ts',
);
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'src/database/migrations');

// ---------------------------------------------------------------------------
// Role → group name mapping (must match the `groups` table values)
//
// Auto-derived from the UserRole enum using the convention:
//   {ROLE_ENUM_KEY}_PERMISSIONS  →  UserRole value
//
// ✅ Adding a new role to UserRole automatically registers it here —
//    no manual update to this script needed.
// ---------------------------------------------------------------------------
const ROLE_GROUP_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(UserRole).map(([key, value]) => [`${key}_PERMISSIONS`, value]),
);

// ---------------------------------------------------------------------------
// Step 1 – Parse permissions.constants.ts
// ---------------------------------------------------------------------------

interface ParsedConstants {
  /** Map of constant key → permission string value, e.g. EDIT_USER → 'edit:user' */
  permissionValues: Map<string, string>;
  /** Map of role array name → set of permission string values */
  rolePermissions: Map<string, Set<string>>;
}

function parsePermissionsConstants(filePath: string): ParsedConstants {
  const src = fs.readFileSync(filePath, 'utf8');

  // --- Extract the PERMISSIONS object ---
  const permissionValues = new Map<string, string>();

  // Match lines like:  KEY: 'value:string',
  const permLineRe = /^\s{2}(\w+):\s*'([^']+)',?\s*$/gm;
  let m: RegExpExecArray | null;

  // We only want lines inside the PERMISSIONS = { ... } block.
  // Find that block first.
  const permBlockMatch = src.match(/const PERMISSIONS\s*=\s*\{([\s\S]*?)\};/);
  if (!permBlockMatch) {
    throw new Error('Could not find PERMISSIONS object in constants file.');
  }
  const permBlock = permBlockMatch[1];

  while ((m = permLineRe.exec(permBlock)) !== null) {
    permissionValues.set(m[1], m[2]);
  }

  // --- Extract each role permission array ---
  const rolePermissions = new Map<string, Set<string>>();

  for (const arrayName of Object.keys(ROLE_GROUP_NAMES)) {
    // Match:  const SUPER_ADMIN_PERMISSIONS = [ ... ];
    const arrayRe = new RegExp(
      `const ${arrayName}\\s*=\\s*\\[([\\s\\S]*?)\\];`,
    );
    const arrayMatch = src.match(arrayRe);
    if (!arrayMatch) continue;

    const arrayBody = arrayMatch[1];
    const set = new Set<string>();

    // Match PERMISSIONS.KEY references inside the array
    const refRe = /PERMISSIONS\.(\w+)/g;
    let ref: RegExpExecArray | null;
    while ((ref = refRe.exec(arrayBody)) !== null) {
      const value = permissionValues.get(ref[1]);
      if (value) set.add(value);
    }

    rolePermissions.set(arrayName, set);
  }

  return { permissionValues, rolePermissions };
}

// ---------------------------------------------------------------------------
// Step 2 – Collect permissions already referenced in existing migrations
// ---------------------------------------------------------------------------

function collectMigratedPermissions(migrationsDir: string): Set<string> {
  const migrated = new Set<string>();

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(migrationsDir, f));

  // Match any single-quoted string that looks like a permission (contains ':')
  const permStringRe = /'([a-z][a-z0-9:_-]+:[a-z][a-z0-9:_-]*)'/g;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = permStringRe.exec(content)) !== null) {
      migrated.add(m[1]);
    }
  }

  return migrated;
}

// ---------------------------------------------------------------------------
// Step 3 – Compute diff
// ---------------------------------------------------------------------------

interface NewPermission {
  value: string;
  roles: string[]; // group names, e.g. ['SUPER_ADMIN', 'LEARNER']
}

function computeDiff(
  parsed: ParsedConstants,
  migrated: Set<string>,
): NewPermission[] {
  // Build a map: permission value → list of group names
  const permToGroups = new Map<string, string[]>();

  for (const [arrayName, values] of parsed.rolePermissions.entries()) {
    const groupName = ROLE_GROUP_NAMES[arrayName];
    for (const value of values) {
      if (!permToGroups.has(value)) permToGroups.set(value, []);
      permToGroups.get(value)!.push(groupName);
    }
  }

  const newPermissions: NewPermission[] = [];

  for (const [, value] of parsed.permissionValues.entries()) {
    if (!migrated.has(value)) {
      newPermissions.push({
        value,
        roles: permToGroups.get(value) ?? [],
      });
    }
  }

  return newPermissions;
}

// ---------------------------------------------------------------------------
// Step 4 – Generate migration file
// ---------------------------------------------------------------------------

function toPascalCase(str: string): string {
  return str
    .replace(/[-_](.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, (_, c: string) => c.toUpperCase());
}

function generateMigrationContent(
  className: string,
  timestamp: number,
  newPermissions: NewPermission[],
): string {
  const allValues = newPermissions.map((p) => p.value);

  // Build VALUES list for permissions INSERT
  const permInsertValues = allValues.map((v) => `        ('${v}')`).join(',\n');

  // Build INSERT for group_permissions – group by unique permission set,
  // so roles that share the exact same permissions collapse into one query
  // using IN on g."name".
  const permSetToRoles = new Map<string, string[]>();
  for (const p of newPermissions) {
    for (const role of p.roles) {
      // key = sorted permission values so identical sets always match
      const key = p.value;
      if (!permSetToRoles.has(key)) permSetToRoles.set(key, []);
      permSetToRoles.get(key)!.push(role);
    }
  }

  // Invert: roles → permissions they share, then emit one query per role group
  const roleSetToPerms = new Map<string, string[]>();
  for (const [perm, roles] of permSetToRoles.entries()) {
    const key = [...roles].sort().join(',');
    if (!roleSetToPerms.has(key)) roleSetToPerms.set(key, []);
    roleSetToPerms.get(key)!.push(perm);
  }

  const groupInserts = [...roleSetToPerms.entries()]
    .map(([rolesKey, perms]) => {
      const roles = rolesKey.split(',');
      const permInList = perms.map((v) => `'${v}'`).join(', ');
      const roleInList = roles.map((r) => `'${r}'`).join(', ');
      const whereClause =
        roles.length === 1
          ? `WHERE g."name" = ${roleInList}`
          : `WHERE g."name" IN (${roleInList})`;
      return `    await queryRunner.query(\`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g
      JOIN "permissions" p ON p."name" IN (${permInList})
      ${whereClause}
    \`);`;
    })
    .join('\n\n');

  // Build IN list for down()
  const inListAll = allValues.map((v) => `'${v}'`).join(', ');

  return `import { MigrationInterface, QueryRunner } from 'typeorm';

export class ${className}${timestamp} implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(\`
      INSERT INTO "permissions" ("name")
      VALUES
${permInsertValues}
    \`);

${groupInserts}
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(\`
      DELETE FROM "group_permissions"
      WHERE "permissionId" IN (
        SELECT "id"
        FROM "permissions"
        WHERE "name" IN (${inListAll})
      )
    \`);

    await queryRunner.query(\`
      DELETE FROM "permissions"
      WHERE "name" IN (${inListAll})
    \`);
  }
}
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  // Resolve migration name from CLI arg: --name=MyMigration or npm_config_name
  const nameArg =
    process.env.npm_config_name ??
    process.argv.find((a) => a.startsWith('--name='))?.replace('--name=', '');

  if (!nameArg) {
    console.error(
      '❌  Please provide a migration name.\n' +
        '   Usage: npm run migration:permissions --name=<MigrationName>\n' +
        '   Example: npm run migration:permissions --name=addReportingPermissions',
    );
    process.exit(1);
  }

  console.log('🔍  Parsing permissions.constants.ts …');
  console.log('   Path:', PERMISSIONS_CONSTANTS_PATH);
  const parsed = parsePermissionsConstants(PERMISSIONS_CONSTANTS_PATH);
  console.log(`   Found ${parsed.permissionValues.size} total permissions.`);

  console.log('🔍  Scanning existing migrations …');
  const migrated = collectMigratedPermissions(MIGRATIONS_DIR);
  console.log(`   Found ${migrated.size} permission strings already migrated.`);

  console.log('🔍  Computing diff …');
  const newPermissions = computeDiff(parsed, migrated);

  if (newPermissions.length === 0) {
    console.log(
      '✅  No new permissions detected. All permissions are already covered by existing migrations.',
    );
    return;
  }

  console.log(`\n🆕  New permissions to migrate (${newPermissions.length}):`);
  for (const p of newPermissions) {
    const roles =
      p.roles.length > 0 ? p.roles.join(', ') : '(no role assigned)';
    console.log(`   • ${p.value}  →  [${roles}]`);
  }

  const timestamp = Date.now();
  const className = toPascalCase(nameArg);
  const fileName = `${timestamp}-${nameArg}.ts`;
  const outputPath = path.join(MIGRATIONS_DIR, fileName);

  const content = generateMigrationContent(
    className,
    timestamp,
    newPermissions,
  );
  fs.writeFileSync(outputPath, content, 'utf8');

  console.log(`\n✅  Migration file generated:\n   ${outputPath}`);
  console.log('\n💡  Review the file, then run:\n   npm run migration:run');
}

main();
