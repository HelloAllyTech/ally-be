import { describeJudgeFailure, judgeAttemptGate } from '../judge-attempts.util';
import { JudgeAttemptFamily } from '../../constants/judge-scheduling.constants';
import { settledEndedSessionPredicate } from '../session-eligibility.util';

describe('judgeAttemptGate', () => {
  const build = () => {
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const sql = judgeAttemptGate(JudgeAttemptFamily.LANGUAGE, 's.id', p);
    return { sql, params };
  };

  it('caps at three attempts and backs off an hour, like foundational skills', () => {
    const { sql, params } = build();

    expect(params).toEqual(['language', 3, 60]);
    expect(sql).toMatch(/ja\.attempts >= \$2/);
    expect(sql).toMatch(
      /ja\."lastAttemptAt" > now\(\) - make_interval\(mins => \$3\)/,
    );
  });

  it('is an exclusion keyed by family and subject', () => {
    const { sql } = build();

    expect(sql).toMatch(/^NOT EXISTS \(/);
    expect(sql).toContain('ja.family = $1');
    expect(sql).toContain('ja."subjectId" = s.id');
  });

  it('numbers its placeholders after whatever the caller already bound', () => {
    const params: unknown[] = ['already', 'bound'];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const sql = judgeAttemptGate(JudgeAttemptFamily.RECALL_QUALITY, 'r.id', p);

    expect(sql).toContain('ja.family = $3');
    expect(params.slice(2)).toEqual(['recall-quality', 3, 60]);
  });
});

describe('describeJudgeFailure', () => {
  const axiosError = (over: Record<string, unknown>) =>
    Object.assign(new Error('irrelevant'), { isAxiosError: true, ...over });

  it('labels a timeout, which ally-ai still finishes and bills', () => {
    expect(describeJudgeFailure(axiosError({ code: 'ECONNABORTED' }))).toBe(
      'timeout (ECONNABORTED)',
    );
    expect(describeJudgeFailure(axiosError({ code: 'ETIMEDOUT' }))).toBe(
      'timeout (ETIMEDOUT)',
    );
  });

  it('labels an HTTP failure by status', () => {
    expect(
      describeJudgeFailure(axiosError({ response: { status: 500 } })),
    ).toBe('http 500');
  });

  it('never stores the message, which can echo transcript text', () => {
    // A driver error can quote the value it rejected — here, a model's quote
    // of what the learner said.
    const err = Object.assign(
      new Error('invalid input syntax: "my husband hits me"'),
      { name: 'QueryFailedError', driverError: { code: '22P02' } },
    );
    const label = describeJudgeFailure(err);

    expect(label).toBe('QueryFailedError 22P02');
    expect(label).not.toContain('husband');
  });

  it('falls back to the error class for anything else', () => {
    expect(describeJudgeFailure(new TypeError('x of undefined'))).toBe(
      'TypeError',
    );
    expect(describeJudgeFailure('a string')).toBe('Error');
    expect(describeJudgeFailure(undefined)).toBe('Error');
  });
});

describe('settledEndedSessionPredicate', () => {
  const sql = settledEndedSessionPredicate('s');

  it('admits only ENDED sessions', () => {
    // ABANDONED is the stuck-session sweeper's reap; ACTIVE is still live.
    expect(sql).toContain(`s.status = 'ENDED'`);
  });

  it('waits fifteen minutes after the end for trailing turns', () => {
    expect(sql).toContain('make_interval(mins => 15)');
  });

  it('falls back to updatedAt when the end flow never wrote endedAt', () => {
    expect(sql).toContain('COALESCE(s."endedAt", s."updatedAt")');
  });

  it('does not filter on eventStatus, so a room that died still counts', () => {
    expect(sql).not.toContain('eventStatus');
  });
});
