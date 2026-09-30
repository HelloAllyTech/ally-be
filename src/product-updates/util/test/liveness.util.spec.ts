import {
  ReleaseHistory,
  changeLiveAt,
  deployableLiveAt,
  deployablesFor,
  pendingDeployables,
} from '../liveness.util';

const at = (iso: string) => new Date(iso);
const run = (started: string, finished: string) => ({
  startedAt: at(started),
  finishedAt: at(finished),
});

describe('deployablesFor', () => {
  it('maps single-app repos to themselves', () => {
    expect(deployablesFor('ally-be', ['src/a.ts'])).toEqual(['ally-be']);
    expect(deployablesFor('ally-mobile', [])).toEqual(['ally-mobile']);
  });

  it('resolves ally-web by app path, and makes libs wait on both product apps', () => {
    expect(
      deployablesFor('ally-web', ['apps/ally-admin-dashboard/src/pages/X.tsx']),
    ).toEqual(['ally-web:admin']);
    expect(
      deployablesFor('ally-web', ['libs/ui-shared/src/Button.tsx']).sort(),
    ).toEqual(['ally-web:admin', 'ally-web:helpline']);
  });

  it("falls back to the journal's changed apps when no files are known", () => {
    expect(deployablesFor('ally-web', [], ['ally-helpline-dashboard'])).toEqual(
      ['ally-web:helpline'],
    );
  });

  it('waits on nothing for root tooling, infra or an unknown repo', () => {
    expect(deployablesFor('ally-web', ['package.json'])).toEqual([]);
    expect(deployablesFor('infra', ['terraform/main.tf'])).toEqual([]);
    expect(deployablesFor('ally-changelog', ['CHANGELOG.md'])).toEqual([]);
  });
});

describe('deployableLiveAt', () => {
  const history: ReleaseHistory = {
    'ally-be': [
      run('2026-09-30T06:52:42Z', '2026-09-30T07:10:00Z'),
      run('2026-09-30T09:52:35Z', '2026-09-30T10:10:00Z'),
    ],
  };

  it('takes the first release that started after the merge', () => {
    expect(
      deployableLiveAt('ally-be', at('2026-09-30T08:42:38Z'), history),
    ).toEqual(at('2026-09-30T10:10:00Z'));
  });

  it('does not count a release that started before the merge', () => {
    expect(
      deployableLiveAt('ally-be', at('2026-09-30T09:53:00Z'), history),
    ).toBeNull();
  });

  it('needs a mobile build after the merge and then a promotion after that build', () => {
    const mobile: ReleaseHistory = {
      'ally-mobile:build': [
        run('2026-09-29T05:02:57Z', '2026-09-29T05:55:00Z'),
      ],
      'ally-mobile:promote': [
        run('2026-09-28T08:00:00Z', '2026-09-28T08:05:00Z'),
        run('2026-09-29T08:31:04Z', '2026-09-29T08:35:00Z'),
      ],
    };

    expect(
      deployableLiveAt('ally-mobile', at('2026-09-29T04:05:21Z'), mobile),
    ).toEqual(at('2026-09-29T08:35:00Z'));
    expect(
      deployableLiveAt('ally-mobile', at('2026-09-29T09:00:00Z'), mobile),
    ).toBeNull();
  });
});

describe('changeLiveAt', () => {
  const history: ReleaseHistory = {
    'ally-be': [run('2026-09-30T09:52:35Z', '2026-09-30T10:10:00Z')],
    'ally-web:admin': [run('2026-09-29T09:40:03Z', '2026-09-29T09:50:00Z')],
  };

  it('is live only when every deployable has shipped', () => {
    const merged = at('2026-09-30T08:42:00Z');
    expect(
      changeLiveAt(['ally-be', 'ally-web:admin'], merged, history),
    ).toBeNull();
    expect(
      pendingDeployables(['ally-be', 'ally-web:admin'], merged, history),
    ).toEqual(['ally-web:admin']);
    expect(changeLiveAt(['ally-be'], merged, history)).toEqual(
      at('2026-09-30T10:10:00Z'),
    );
  });

  it('is live on merge when there is nothing to wait for', () => {
    const merged = at('2026-09-30T08:42:00Z');
    expect(changeLiveAt([], merged, history)).toEqual(merged);
  });
});
