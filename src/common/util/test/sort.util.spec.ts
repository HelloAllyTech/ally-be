import { resolveSort } from '../sort.util';

/**
 * This helper stands between a query string and an ORDER BY clause, so its whitelist is a security
 * control, not a convenience. The tests that matter are the ones proving an attacker-supplied key
 * cannot reach SQL, and that a merely-stale key degrades to the default instead of erroring on a
 * read-only screen.
 */
describe('resolveSort', () => {
  const COLUMNS = {
    createdAt: 'q.createdAt',
    topSimilarity: 'q.topSimilarity',
  };

  describe('the whitelist', () => {
    it('maps a known key to its column expression', () => {
      expect(
        resolveSort(COLUMNS, 'q.createdAt', 'topSimilarity', 'asc'),
      ).toEqual({
        column: 'q.topSimilarity',
        direction: 'ASC',
      });
    });

    it.each([
      'q.createdAt; DROP TABLE wa_messages',
      '(SELECT 1)',
      'contact.phone_e164',
      '__proto__',
      'constructor',
      'toString',
    ])('never passes %s through to the column', (malicious) => {
      // Includes prototype-chain keys: a plain object lookup would return Object.prototype members
      // for these, so a bare `columns[key]` is not by itself a whitelist.
      const { column } = resolveSort(COLUMNS, 'q.createdAt', malicious, 'desc');
      expect(column).toBe('q.createdAt');
    });

    it('falls back rather than throwing on an unknown key', () => {
      // A renamed sort key in someone's bookmark should render the default order, not 400 a screen
      // whose whole job is reading.
      expect(
        resolveSort(COLUMNS, 'q.createdAt', 'whateverWasRemoved').column,
      ).toBe('q.createdAt');
    });
  });

  describe('direction', () => {
    it.each([
      ['asc', 'ASC'],
      ['ASC', 'ASC'],
      ['desc', 'DESC'],
      ['DESC', 'DESC'],
    ])('accepts %s', (input, expected) => {
      expect(
        resolveSort(COLUMNS, 'q.createdAt', 'createdAt', input).direction,
      ).toBe(expected);
    });

    it('defaults to descending for logs and worklists', () => {
      // Newest, biggest, worst first is what a reader wants from a column they just reached for.
      expect(resolveSort(COLUMNS, 'q.createdAt', 'createdAt').direction).toBe(
        'DESC',
      );
      expect(
        resolveSort(COLUMNS, 'q.createdAt', 'createdAt', 'sideways').direction,
      ).toBe('DESC');
    });

    it('honours an explicit ascending fallback', () => {
      expect(
        resolveSort(COLUMNS, 'q.createdAt', undefined, undefined, 'ASC')
          .direction,
      ).toBe('ASC');
    });
  });
});
