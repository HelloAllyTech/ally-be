import * as fs from 'fs';
import * as path from 'path';

describe('.env.example', () => {
  it('should contain ANTHROPIC_API_KEY', () => {
    const envExamplePath = path.resolve(__dirname, '../../.env.example');
    const envExampleContent = fs.readFileSync(envExamplePath, 'utf8');
    expect(envExampleContent).toContain('ANTHROPIC_API_KEY');
  });
});
