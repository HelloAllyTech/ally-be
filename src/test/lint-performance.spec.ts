import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR = path.join(__dirname, 'temp-lint-test');
const CACHE_FILE = path.join(process.cwd(), '.eslintcache');
const NUM_FILES = 20;

function setup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  if (fs.existsSync(CACHE_FILE)) {
    fs.rmSync(CACHE_FILE);
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
  const fileContent = 'export const x = 1;\\n'.repeat(100);
  for (let i = 0; i < NUM_FILES; i++) {
    fs.writeFileSync(path.join(TEST_DIR, `file${i}.ts`), fileContent);
  }
}

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  if (fs.existsSync(CACHE_FILE)) {
    fs.rmSync(CACHE_FILE);
  }
}

describe('Lint performance', () => {
  beforeEach(() => {
    setup();
  });

  afterEach(() => {
    cleanup();
  });

  it('should be faster on the second run with caching', () => {
    const lintCommand = `eslint --cache '${TEST_DIR}/**/*.ts'`;

    const startTime1 = Date.now();
    try {
      execSync(lintCommand);
    } catch {
      // Ignore linting errors
    }
    const endTime1 = Date.now();
    const duration1 = endTime1 - startTime1;

    expect(fs.existsSync(CACHE_FILE)).toBe(true);

    const startTime2 = Date.now();
    try {
      execSync(lintCommand);
    } catch {
      // Ignore linting errors
    }
    const endTime2 = Date.now();
    const duration2 = endTime2 - startTime2;

    console.log(`First run: ${duration1}ms, Second run: ${duration2}ms`);

    expect(duration2).toBeLessThan(duration1);
  });
});
