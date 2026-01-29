#!/usr/bin/env node
/**
 * Database Seed Orchestrator
 *
 * This script manages the execution of all database seeds in the correct order.
 * It ensures dependencies are met and provides clear logging of progress.
 *
 * Execution order:
 * 1. admin-user.ts - Creates super-admin user
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
import { logStep } from './seed-utils';
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
    script: 'admin-user.ts',
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
  {
    name: 'Badges',
    description: 'Creating achievement badges for all categories',
    script: 'seed-badges.ts',
    required: false,
    timeout: 30000,
  },
];

let completedTasks = 0;
const failedTasks: string[] = [];
const startTime = Date.now();

function logHeader(text: string): void {
  logStep('\n' + '='.repeat(70));
  logStep(`  ${text}`);
  logStep('='.repeat(70));
}

// logStep now imported from seed-utils and used for all info/progress logs

function logSuccess(message: string): void {
  logStep(`✅ ${message}`);
}

function logError(message: string): void {
  logStep(`❌ ${message}`);
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

    logStep(`[${task.name}] ${task.description}`);

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

  logStep('\n📋 Seed Tasks:');
  seedTasks.forEach((task, index) => {
    const status = task.required ? '[REQUIRED]' : '[OPTIONAL]';
    logStep(`  ${index + 1}. ${task.name} ${status}`);
    logStep(`     └─ ${task.description}`);
  });

  logStep('\n⏱️  Starting seed execution...\n');

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

  logStep('\n📈 Statistics:');
  logStep(`  Total Tasks: ${seedTasks.length}`);
  logStep(`  Completed: ${completedTasks}`);
  logStep(`  Failed: ${failedTasks.length}`);
  logStep(`  Duration: ${durationSeconds}s`);

  if (failedTasks.length > 0) {
    logStep('\n⚠️  Failed Tasks:');
    failedTasks.forEach((task) => {
      logStep(`  • ${task}`);
    });
  }

  // Final status
  logStep('\n' + '-'.repeat(70));
  if (failedTasks.length === 0) {
    logSuccess('All seeds executed successfully!');
    logStep('\n🎉 Database seeding completed!');
    logStep('\n📝 TEST_ACCOUNTS Configuration for OTP Login:');
    logStep(
      '   ✓ The .env file has been automatically updated with all test user credentials.',
    );
    logStep('\n   📋 How to use TEST_ACCOUNTS:');
    logStep(
      '   Copy all email-OTP pairs in this exact JSON format into your .env file:',
    );
    logStep(
      '\n   TEST_ACCOUNTS={"email1@domain.com":"otp1","email2@domain.com":"otp2",...}',
    );
    logStep('\n   Example with seeded users:');
    logStep(
      '   TEST_ACCOUNTS={"admin@example.com":"1234","counselor@example.com":"1234","learner@example.com":"1234","org-admin@example.com":"1234","user-cla@example.com":"1234"}',
    );
    logStep('\n✅ Test Users Available for OTP Login:');
    logStep('   • Admin:     admin@example.com / OTP: 1234');
    logStep('   • Counselor: counselor@example.com / OTP: 1234');
    logStep('   • Learner:   learner@example.com / OTP: 1234');
    logStep('   • Org Admin: org-admin@example.com / OTP: 1234');
    logStep('   • User CLA:  user-cla@example.com / OTP: 1234');
    logStep(
      '\n💡 All test users are pre-configured in .env with OTP codes for easy authentication.',
    );
    logStep(
      '   Simply use any of the above email addresses with OTP "1234" to login to the application.',
    );
    logStep('-'.repeat(70) + '\n');
    process.exit(0);
  } else {
    logError('Seeding completed with errors!');
    logStep('\n❌ Some required seeds failed. Please check the errors above.');
    logStep('-'.repeat(70) + '\n');
    process.exit(1);
  }
}

// Run the orchestrator
main().catch((error) => {
  console.error('Fatal error in seed orchestrator:', error);
  process.exit(1);
});
