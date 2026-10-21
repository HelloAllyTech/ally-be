import { studyContradictsFault } from '../bug-fix-study.service';
import { BugFaultLocation } from '../../type/bug-finding-verdict.type';
import { BugFixStudy } from '../../type/bug-fix-study.type';

describe('studyContradictsFault (repro)', () => {
  const codeFault: BugFaultLocation = {
    layer: 'code',
    repo: 'ally-be',
    evidence: 'test evidence',
    repair: null,
  };

  it('should return a contradiction if fault is code and study is database', () => {
    const study: Pick<BugFixStudy, 'valueLivesIn'> = {
      valueLivesIn: 'database',
    };
    const result = studyContradictsFault(study, codeFault);
    expect(result).not.toBeNull();
    expect(result).toContain('located this fault in code');
    expect(result).toContain(
      `your study says the value lives in ${study.valueLivesIn}`,
    );
  });

  it('should return a contradiction if fault is code and study is locale_file', () => {
    const study: Pick<BugFixStudy, 'valueLivesIn'> = {
      valueLivesIn: 'locale_file',
    };
    const result = studyContradictsFault(study, codeFault);
    expect(result).not.toBeNull();
  });

  it('should return a contradiction if fault is code and study is config', () => {
    const study: Pick<BugFixStudy, 'valueLivesIn'> = {
      valueLivesIn: 'config',
    };
    const result = studyContradictsFault(study, codeFault);
    expect(result).not.toBeNull();
  });
});
