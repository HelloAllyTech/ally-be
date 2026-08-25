import { execFileSync } from 'child_process';
import * as path from 'path';

describe('lint gate', () => {
  it('has no prettier/prettier formatting errors across the codebase', () => {
    const repoRoot = path.join(__dirname, '../../..');

    let output = '';
    try {
      execFileSync('npm', ['run', 'lint'], { cwd: repoRoot, encoding: 'utf8' });
    } catch (error) {
      output = (error as { stdout?: string }).stdout ?? '';
    }

    expect(output).not.toContain('prettier/prettier');
  });
});
