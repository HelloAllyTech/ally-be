const { execSync } = require('child_process');

const name = process.env.npm_config_name;

if (!name) {
  console.error('❌ Missing migration name. Run with --name=YourMigrationName');
  process.exit(1);
}

const path = `src/database/migrations/${name}`;
const command = `npx typeorm-ts-node-commonjs migration:create ${path}`;

console.log(`📦 Creating migration at: ${path}`);
execSync(command, { stdio: 'inherit' });
