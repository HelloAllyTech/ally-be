import { findBuilderRepo } from '../constants/builder-repos.constants';
import { renderRepoChecks } from './builder-pipeline.controller';

describe('renderRepoChecks', () => {
  it('names the extra checks CI blocks on, not only test and lint', () => {
    const text = renderRepoChecks([findBuilderRepo('ally-web')!]);

    expect(text).toContain('`npm run lint:colors`');
    expect(text).toContain('`npx tsc -b --pretty false`');
  });

  it('carries the docs rule a fix run cannot satisfy later', () => {
    const text = renderRepoChecks([findBuilderRepo('ally-be')!]);

    expect(text).toContain('.docs-map.yml');
    expect(text).toContain('Wiki-PR: none');
  });

  it('is empty without a repo', () => {
    expect(renderRepoChecks([])).toBe('');
  });
});
