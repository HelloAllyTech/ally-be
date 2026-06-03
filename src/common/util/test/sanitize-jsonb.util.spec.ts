import {
  sanitizeJsonbMetadata,
  sanitizeJsonbValue,
  stripUnsafeJsonbChars,
} from '../sanitize-jsonb.util';

// Explicit control-byte references used across the suite. Defined as
// hex escapes (rather than literal control bytes) so the source file
// stays reviewable in editor / diff / copy-paste — the NUL byte in
// particular is silently eaten by many text pipelines.
const NUL = '\x00';
const SOH = '\x01';
// Field separator — the literal byte that caused the original Postgres
// 22P05 we saw in scenario_translations.openingStatements:
const FS = '\x1C';
const DEL = '\x7F';

describe('sanitize-jsonb.util', () => {
  describe('stripUnsafeJsonbChars', () => {
    it('returns the same instance when nothing needs stripping', () => {
      const input = 'plain ascii — including em-dash and unicode é';
      expect(stripUnsafeJsonbChars(input)).toBe(input);
    });

    it('strips NUL bytes (the Postgres jsonb 22P05 trigger)', () => {
      expect(stripUnsafeJsonbChars(`hello${NUL}world`)).toBe('helloworld');
      expect(stripUnsafeJsonbChars(`${NUL}${NUL}${NUL}`)).toBe('');
    });

    it('strips other C0 control characters (SOH, FS, etc.)', () => {
      expect(stripUnsafeJsonbChars(`${SOH}prefix${FS}suffix`)).toBe(
        'prefixsuffix',
      );
    });

    it('strips DEL (U+007F)', () => {
      expect(stripUnsafeJsonbChars(`x${DEL}y`)).toBe('xy');
    });

    it('preserves the three whitespace controls: tab, newline, carriage-return', () => {
      const s = 'a\tb\nc\rd';
      expect(stripUnsafeJsonbChars(s)).toBe(s);
    });

    it('handles empty / falsy input gracefully', () => {
      expect(stripUnsafeJsonbChars('')).toBe('');
      // The runtime guards on truthiness so `null` / `undefined`-like
      // values pass through cleanly when accidentally fed in.
      expect(stripUnsafeJsonbChars(null as unknown as string)).toBeNull();
      expect(
        stripUnsafeJsonbChars(undefined as unknown as string),
      ).toBeUndefined();
    });

    it('handles a long string with a single embedded NUL', () => {
      const long = 'x'.repeat(10_000) + NUL + 'y'.repeat(10_000);
      const result = stripUnsafeJsonbChars(long);
      expect(result).toHaveLength(20_000);
      expect(result.includes(NUL)).toBe(false);
    });
  });

  describe('sanitizeJsonbValue', () => {
    it('cleans top-level strings', () => {
      expect(sanitizeJsonbValue(`evil${NUL}value`)).toBe('evilvalue');
    });

    it('recurses into arrays — the openingStatements bug', () => {
      const input = [
        'first',
        `bad${NUL}greeting`,
        `another${FS}with${NUL}two${SOH}chars`,
      ];
      const cleaned = sanitizeJsonbValue(input);
      expect(cleaned).toEqual(['first', 'badgreeting', 'anotherwithtwochars']);
    });

    it('recurses into nested objects', () => {
      const input = {
        openingStatements: [`hi${NUL}`, 'ok'],
        translations: {
          fr: { greeting: `bonjour${NUL}` },
        },
      };
      expect(sanitizeJsonbValue(input)).toEqual({
        openingStatements: ['hi', 'ok'],
        translations: {
          fr: { greeting: 'bonjour' },
        },
      });
    });

    it('returns the same array reference when nothing needs cleaning', () => {
      const input = ['a', 'b', 'c'];
      expect(sanitizeJsonbValue(input)).toBe(input);
    });

    it('returns the same object reference when nothing needs cleaning', () => {
      const input = { a: 1, b: 'plain', c: [1, 2] };
      expect(sanitizeJsonbValue(input)).toBe(input);
    });

    it('passes through primitives untouched', () => {
      expect(sanitizeJsonbValue(42)).toBe(42);
      expect(sanitizeJsonbValue(true)).toBe(true);
      expect(sanitizeJsonbValue(null)).toBeNull();
      expect(sanitizeJsonbValue(undefined)).toBeUndefined();
    });

    it('preserves empty arrays and empty objects as-is', () => {
      const arr: unknown[] = [];
      const obj: Record<string, unknown> = {};
      expect(sanitizeJsonbValue(arr)).toBe(arr);
      expect(sanitizeJsonbValue(obj)).toBe(obj);
    });

    it('does not filter out empty / null entries inside arrays', () => {
      // Array filtering is a domain concern, not the sanitizer's job.
      // The input shape is preserved; only character cleanup happens.
      const input = ['a', '', null, undefined, `bad${NUL}`];
      expect(sanitizeJsonbValue(input)).toEqual([
        'a',
        '',
        null,
        undefined,
        'bad',
      ]);
    });

    it('leaves non-plain objects (Date, Buffer) untouched', () => {
      const d = new Date('2026-01-01T00:00:00Z');
      const buf = Buffer.from(`hello${NUL}world`, 'utf8');
      const input = { when: d, payload: buf };
      const out = sanitizeJsonbValue(input);
      // Because the plain-object container has no string children to
      // clean, the returned object should be reference-identical to the
      // input — proving we did NOT walk into the Date / Buffer.
      expect(out).toBe(input);
      expect(out.when).toBe(d);
      expect(out.payload).toBe(buf);
    });

    it('handles Object.create(null) maps', () => {
      const m: Record<string, unknown> = Object.create(null);
      m.greeting = `hi${NUL}there`;
      const out = sanitizeJsonbValue(m);
      expect(out.greeting).toBe('hithere');
    });

    it('cleans deeply-nested mixed structures', () => {
      const input = {
        a: [{ b: [`x${NUL}`, { c: `deep${SOH}` }] }, { b: ['clean'] }],
      };
      expect(sanitizeJsonbValue(input)).toEqual({
        a: [{ b: ['x', { c: 'deep' }] }, { b: ['clean'] }],
      });
    });
  });

  describe('sanitizeJsonbMetadata', () => {
    it('returns {} for null / undefined / non-object', () => {
      expect(sanitizeJsonbMetadata(null)).toEqual({});
      expect(sanitizeJsonbMetadata(undefined)).toEqual({});
      expect(
        sanitizeJsonbMetadata(
          'not-an-object' as unknown as Record<string, any>,
        ),
      ).toEqual({});
    });

    it('drops null / undefined top-level values', () => {
      const result = sanitizeJsonbMetadata({
        keep: 'value',
        dropNull: null,
        dropUndef: undefined,
      });
      expect(result).toEqual({ keep: 'value' });
    });

    it('trims top-level strings and strips control chars before trim', () => {
      // The original behavior was just `.trim()` — we now additionally
      // strip control bytes BEFORE trimming, so a string that is
      // whitespace around a NUL still collapses to "" and the key gets
      // dropped.
      const result = sanitizeJsonbMetadata({
        clean: `  ${NUL}padded${NUL}  `,
        dropMe: `   ${NUL}   `,
      });
      expect(result).toEqual({ clean: 'padded' });
    });

    it('recurses into nested arrays — repro of the openingStatements 22P05', () => {
      // This is the exact shape that failed in
      // INSERT INTO scenario_translations (...) — a `metadata` jsonb
      // whose openingStatements contained a stray NUL byte from a
      // translation provider.
      const result = sanitizeJsonbMetadata({
        openingStatements: [
          `${SOH}00${SOH}5${NUL}whatever`,
          'normal opening line',
        ],
      });
      expect(result).toEqual({
        openingStatements: ['005whatever', 'normal opening line'],
      });
    });

    it('preserves non-string scalar fields (numbers, booleans)', () => {
      expect(
        sanitizeJsonbMetadata({
          count: 42,
          enabled: true,
          disabled: false,
          zero: 0,
        }),
      ).toEqual({ count: 42, enabled: true, disabled: false, zero: 0 });
    });

    it('keeps the original drop-empty-string contract at the top level', () => {
      const result = sanitizeJsonbMetadata({
        keep: 'value',
        empty: '',
        whitespaceOnly: '   ',
      });
      expect(result).toEqual({ keep: 'value' });
    });

    it('cleans nested objects too', () => {
      const result = sanitizeJsonbMetadata({
        translations: {
          fr: { greeting: `bonjour${NUL}` },
          de: { greeting: 'hallo' },
        },
      });
      expect(result).toEqual({
        translations: {
          fr: { greeting: 'bonjour' },
          de: { greeting: 'hallo' },
        },
      });
    });

    it('preserves \\t \\n \\r inside top-level strings', () => {
      // The trim() bit will eat leading/trailing whitespace but interior
      // newlines / tabs are user content (e.g. multiline descriptions).
      const result = sanitizeJsonbMetadata({
        description: 'line1\nline2\tcol2',
      });
      expect(result).toEqual({ description: 'line1\nline2\tcol2' });
    });
  });
});
