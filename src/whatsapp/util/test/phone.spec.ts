import {
  PHONE_MATCH_DIGITS,
  isSamePhone,
  phoneDigits,
  phoneKey,
} from '../phone';

/**
 * The one definition of "the same number", shared by the resolver and the mapping table.
 *
 * It has to be shared, and these tests exist to keep it that way: the failure mode of two
 * implementations is an admin seeing a mapping in the table while the bot still refuses the
 * worker, with nothing anywhere saying why.
 */
describe('phone matching', () => {
  it('treats the three shapes real data holds as one number', () => {
    const keys = ['+91 98765 43210', '919876543210', '9876543210'].map(
      phoneKey,
    );

    expect(new Set(keys).size).toBe(1);
  });

  it('strips everything that is not a digit', () => {
    expect(phoneDigits('+91 (98765)-43210')).toBe('919876543210');
  });

  it('refuses a number too short to identify anyone', () => {
    // An eight-digit suffix collides across a large user base, so a short number gets NO key
    // rather than a key that would match every other short number.
    expect(phoneKey('12345')).toBe('');
    expect(phoneKey('')).toBe('');
  });

  it('accepts a number of exactly the match length', () => {
    expect(phoneKey('9876543210')).toHaveLength(PHONE_MATCH_DIGITS);
  });

  it('matches a national number against its E.164 form', () => {
    expect(isSamePhone('9876543210', '919876543210')).toBe(true);
  });

  it('rejects a different country sharing the same last ten digits', () => {
    // The key is what the database can index; this is the check that rejects the near-miss.
    expect(isSamePhone('449876543210', '919876543210')).toBe(false);
  });

  it('never matches two unidentifiable numbers to each other', () => {
    expect(isSamePhone('123', '123')).toBe(false);
  });

  it('handles null and undefined without throwing', () => {
    expect(phoneKey(null)).toBe('');
    expect(isSamePhone(undefined, '919876543210')).toBe(false);
  });
});
