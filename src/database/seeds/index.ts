#!/usr/bin/env node
/**
 * Database Seed Orchestrator
 *
 * This script manages the execution of all database seeds in the correct order.
 * It ensures dependencies are met and provides clear logging of progress.
 *
 * Execution order:
 * 1. admin_user.ts - Creates super-admin user
 * 2. seed-voices-and-events.ts - Seeds voices and session events
 * 3. user-tenant.ts - Creates tenant and test users
 * 4. scenarios-pathway.ts - Creates scenarios and learning paths
 *
 * Usage:
 *   npm run seed:all
 *   or
 *   ts-node -r tsconfig-paths/register src/database/seeds/index.ts
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface SeedTask {
  name: string;
  description: string;
  script: string;
  required: boolean;
  timeout: number;
}

const seedTasks: SeedTask[] = [
  {
    name: 'Admin User',
    description: 'Creating super-admin user',
    script: 'admin_user.ts',
    required: true,
    timeout: 30000,
  },
  {
    name: 'Voices & Events',
    description: 'Seeding scenario voices and session events',
    script: 'seed-voices-and-events.ts',
    required: true,
    timeout: 30000,
  },
  {
    name: 'Users & Tenant',
    description: 'Creating tenant and test users',
    script: 'user-tenant.ts',
    required: true,
    timeout: 30000,
  },
  {
    name: 'Scenarios & Paths',
    description: 'Creating scenarios and learning paths',
    script: 'scenarios-pathway.ts',
    required: false,
    timeout: 60000,
  },
];

let completedTasks = 0;
const failedTasks: string[] = [];
const startTime = Date.now();

function logHeader(text: string): void {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${text}`);
  console.log('='.repeat(70));
}

function logStep(taskName: string, message: string): void {
  console.log(`\n[${taskName}] ${message}`);
}

function logSuccess(message: string): void {
  console.log(`✅ ${message}`);
}

function logError(message: string): void {
  console.log(`❌ ${message}`);
}

async function executeSeedTask(task: SeedTask): Promise<boolean> {
  return new Promise((resolve) => {
    const scriptPath = path.resolve(__dirname, task.script);

    // Verify script exists
    if (!fs.existsSync(scriptPath)) {
      logError(`Script not found: ${scriptPath}`);
      if (task.required) {
        failedTasks.push(task.name);
      }
      resolve(!task.required);
      return;
    }

    logStep(task.name, task.description);

    const child = spawn(
      'ts-node',
      ['-r', 'tsconfig-paths/register', scriptPath],
      {
        cwd: path.resolve(__dirname, '..', '..', '..'),
        stdio: 'inherit',
        timeout: task.timeout,
      },
    );

    child.on('close', (code) => {
      if (code === 0) {
        logSuccess(`${task.name} seed completed`);
        resolve(true);
      } else {
        logError(`${task.name} seed failed with code ${code}`);
        if (task.required) {
          failedTasks.push(task.name);
        }
        resolve(!task.required);
      }
    });

    child.on('error', (error) => {
      logError(`${task.name} seed error: ${error.message}`);
      if (task.required) {
        failedTasks.push(task.name);
      }
      resolve(!task.required);
    });
  });
}

async function main(): Promise<void> {
  logHeader('🌱 DATABASE SEED ORCHESTRATOR');

  console.log('\n📋 Seed Tasks:');
  seedTasks.forEach((task, index) => {
    const status = task.required ? '[REQUIRED]' : '[OPTIONAL]';
    console.log(`  ${index + 1}. ${task.name} ${status}`);
    console.log(`     └─ ${task.description}`);
  });

  console.log('\n⏱️  Starting seed execution...\n');

  for (const task of seedTasks) {
    try {
      const success = await executeSeedTask(task);
      if (success) {
        completedTasks++;
      }
    } catch (error) {
      logError(`Unexpected error in ${task.name}: ${error}`);
      if (task.required) {
        failedTasks.push(task.name);
      }
    }
  }

  // Generate summary report
  const duration = Date.now() - startTime;
  const durationSeconds = Math.round(duration / 1000);

  logHeader('📊 SEED EXECUTION SUMMARY');

  console.log('\n📈 Statistics:');
  console.log(`  Total Tasks: ${seedTasks.length}`);
  console.log(`  Completed: ${completedTasks}`);
  console.log(`  Failed: ${failedTasks.length}`);
  console.log(`  Duration: ${durationSeconds}s`);

  if (failedTasks.length > 0) {
    console.log('\n⚠️  Failed Tasks:');
    failedTasks.forEach((task) => {
      console.log(`  • ${task}`);
    });
  }

  // Final status
  console.log('\n' + '-'.repeat(70));
  if (failedTasks.length === 0) {
    logSuccess('All seeds executed successfully!');
    console.log('\n🎉 Database seeding completed!');
    console.log('\n📝 TEST_ACCOUNTS Configuration for OTP Login:');
    console.log(
      '   ✓ The .env file has been automatically updated with all test user credentials.',
    );
    console.log('\n   📋 How to use TEST_ACCOUNTS:');
    console.log(
      '   Copy all email-OTP pairs in this exact JSON format into your .env file:',
    );
    console.log(
      '\n   TEST_ACCOUNTS={"email1@domain.com":"otp1","email2@domain.com":"otp2",...}',
    );
    console.log('\n   Example with seeded users:');
    console.log(
      '   TEST_ACCOUNTS={"admin@example.com":"1234","counselor@example.com":"1234","learner@example.com":"1234","org-admin@example.com":"1234","user-cla@example.com":"1234"}',
    );
    console.log('\n✅ Test Users Available for OTP Login:');
    console.log('   • Admin:     admin@example.com / OTP: 1234');
    console.log('   • Counselor: counselor@example.com / OTP: 1234');
    console.log('   • Learner:   learner@example.com / OTP: 1234');
    console.log('   • Org Admin: org-admin@example.com / OTP: 1234');
    console.log('   • User CLA:  user-cla@example.com / OTP: 1234');
    console.log(
      '\n💡 All test users are pre-configured in .env with OTP codes for easy authentication.',
    );
    console.log(
      '   Simply use any of the above email addresses with OTP "1234" to login to the application.',
    );
    console.log('-'.repeat(70) + '\n');
    process.exit(0);
  } else {
    logError('Seeding completed with errors!');
    console.log(
      '\n❌ Some required seeds failed. Please check the errors above.',
    );
    console.log('-'.repeat(70) + '\n');
    process.exit(1);
  }
}

// Run the orchestrator
main().catch((error) => {
  console.error('Fatal error in seed orchestrator:', error);
  process.exit(1);
});
