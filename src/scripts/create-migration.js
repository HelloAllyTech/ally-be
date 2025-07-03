const { execSync } = require('child_process');

const name = process.env.npm_config_name;

if (!name) {
  console.error('❌ Missing migration name. Run with --name=YourMigrationName');
  process.exit(1);
}

// Sanitize the name to prevent command injection
const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, '');
const path = `src/database/migrations/${sanitizedName}`;
const command = `npx typeorm-ts-node-commonjs migration:create ${JSON.stringify(path)}`;

console.log(`📦 Creating migration at: ${path}`);

try {
  execSync(command, { stdio: 'inherit' });
  console.log('✅ Migration created successfully!');
} catch (error) {
  console.error('❌ Failed to create migration:', error.message);
  process.exit(1);
}
