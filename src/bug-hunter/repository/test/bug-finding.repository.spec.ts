import { BugFindingRepository } from '../bug-finding.repository';

const key = BugFindingRepository.dedupeKey;
const fingerprint = BugFindingRepository.descriptionFingerprint;

/**
 * These tests pin the behaviour migration 1910000000000 exists for: the dedupe
 * key must identify a bug by WHERE it is, not by how an LLM happened to word it
 * that night. The old key hashed the raw description, so a reworded rediscovery
 * opened a duplicate row and the sweep generated its own reviewer noise.
 */
describe('BugFindingRepository.dedupeKey', () => {
  describe('when the finder supplies a symbol', () => {
    it('is stable across completely different wordings of the same bug', () => {
      const a = key(
        'src/user/user.service.ts',
        'code_review',
        'findByEmail',
        'findByEmail does not filter by tenantId, leaking users across orgs',
      );
      const b = key(
        'src/user/user.service.ts',
        'code_review',
        'findByEmail',
        'Missing tenant scoping in findByEmail — a caller can read another organisation. Line 214.',
      );
      expect(a).toBe(b);
    });

    it('separates two different symbols in the same file', () => {
      const a = key('src/a.ts', 'code_review', 'parseHeader', 'desc');
      const b = key('src/a.ts', 'code_review', 'parseBody', 'desc');
      expect(a).not.toBe(b);
    });

    it('separates the same symbol found by different finders', () => {
      // A lint complaint and a logic bug on one function are two findings; they
      // get fixed differently and should not collapse into one row.
      const lint = key('src/a.ts', 'lint_error', 'parseHeader', 'desc');
      const review = key('src/a.ts', 'code_review', 'parseHeader', 'desc');
      expect(lint).not.toBe(review);
    });

    it('separates the same symbol name in different files', () => {
      const a = key('src/a.ts', 'code_review', 'handle', 'desc');
      const b = key('src/b.ts', 'code_review', 'handle', 'desc');
      expect(a).not.toBe(b);
    });

    it('ignores symbol whitespace and casing', () => {
      expect(key('f.ts', 'code_review', '  findByEmail  ', 'x')).toBe(
        key('f.ts', 'code_review', 'FindByEmail', 'y'),
      );
    });

    it('ignores the description entirely once a symbol is present', () => {
      expect(key('f.ts', 'code_review', 'fn', 'one thing')).toBe(
        key('f.ts', 'code_review', 'fn', 'something totally unrelated'),
      );
    });
  });

  describe('when the finder supplies no symbol', () => {
    it('still collapses a rewording of the same bug', () => {
      // The fallback path: same claim, different phrasing and line number.
      const a = key(
        'src/a.ts',
        'code_review',
        undefined,
        'The retry loop never resets the counter, so it retries forever',
      );
      const b = key(
        'src/a.ts',
        'code_review',
        undefined,
        'Retry counter is never reset — loop retries forever (line 88)',
      );
      expect(a).toBe(b);
    });

    it('keeps two genuinely different bugs in one file apart', () => {
      const a = key(
        'src/a.ts',
        'code_review',
        null,
        'Retry counter never resets',
      );
      const b = key(
        'src/a.ts',
        'code_review',
        null,
        'Timezone offset applied twice',
      );
      expect(a).not.toBe(b);
    });

    it('treats an empty or whitespace-only symbol as absent', () => {
      const viaEmpty = key(
        'src/a.ts',
        'code_review',
        '   ',
        'Retry counter never resets',
      );
      const viaMissing = key(
        'src/a.ts',
        'code_review',
        undefined,
        'Retry counter never resets',
      );
      expect(viaEmpty).toBe(viaMissing);
    });
  });

  it('tolerates a null file — a reported bug is not repo-located yet', () => {
    expect(() =>
      key(null, 'reported_bug', null, 'App crashes on login'),
    ).not.toThrow();
    expect(key(null, 'reported_bug', null, 'x')).toBe(
      key(undefined, 'reported_bug', null, 'x'),
    );
  });

  it('does not hash repo in — repo stays a separate indexed WHERE clause', () => {
    // Guards the contract findOpenByDedupeKey relies on: it filters repo in SQL,
    // so the key itself must be repo-independent or that filter would be dead.
    expect(key('src/a.ts', 'code_review', 'fn', 'd')).toHaveLength(64);
  });
});

describe('BugFindingRepository.descriptionFingerprint', () => {
  it('drops line numbers and other digits', () => {
    expect(fingerprint('Broken at line 42')).toBe(
      fingerprint('Broken at line 9999'),
    );
  });

  it('ignores word order', () => {
    expect(fingerprint('tenant scoping missing')).toBe(
      fingerprint('missing tenant scoping'),
    );
  });

  it('ignores quoting style', () => {
    expect(fingerprint(`the "user" field`)).toBe(
      fingerprint("the 'user' field"),
    );
  });

  it('ignores stopwords and filler', () => {
    expect(fingerprint('the counter is never reset')).toBe(
      fingerprint('counter reset'),
    );
  });

  it('ignores repetition', () => {
    expect(fingerprint('retry retry retry loop')).toBe(
      fingerprint('retry loop'),
    );
  });

  it('still distinguishes different content words', () => {
    expect(fingerprint('counter never reset')).not.toBe(
      fingerprint('timezone applied twice'),
    );
  });

  it('returns empty for prose with no content words', () => {
    expect(fingerprint('the a an is 123')).toBe('');
  });
});
