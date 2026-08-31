import {
  applyJsonPatch,
  JsonPatchError,
  parseJsonPointer,
  resolveJsonPointer,
} from './json-patch.util';

describe('json-patch.util', () => {
  describe('parseJsonPointer', () => {
    it('parses the empty pointer as the whole document', () => {
      expect(parseJsonPointer('')).toEqual([]);
    });

    it('parses nested segments', () => {
      expect(parseJsonPointer('/a/b/0')).toEqual(['a', 'b', '0']);
    });

    it('unescapes ~0 and ~1 per RFC 6901', () => {
      expect(parseJsonPointer('/a~1b/c~0d')).toEqual(['a/b', 'c~d']);
    });

    it('rejects pointers that do not start with "/"', () => {
      expect(() => parseJsonPointer('a/b')).toThrow(JsonPatchError);
    });
  });

  describe('applyJsonPatch', () => {
    it('does not mutate the input document', () => {
      const doc = { a: { b: 1 } };
      const result = applyJsonPatch(doc, [
        { op: 'replace', path: '/a/b', value: 2 },
      ]);
      expect(doc.a.b).toBe(1);
      expect(result.a.b).toBe(2);
    });

    it('adds a new object member', () => {
      expect(applyJsonPatch({}, [{ op: 'add', path: '/x', value: 5 }])).toEqual(
        { x: 5 },
      );
    });

    it('add overwrites an existing object member (RFC 6902 semantics)', () => {
      expect(
        applyJsonPatch({ x: 1 }, [{ op: 'add', path: '/x', value: 2 }]),
      ).toEqual({ x: 2 });
    });

    it('inserts into an array at an index', () => {
      expect(
        applyJsonPatch({ arr: [1, 3] }, [
          { op: 'add', path: '/arr/1', value: 2 },
        ]),
      ).toEqual({ arr: [1, 2, 3] });
    });

    it('appends to an array with "-"', () => {
      expect(
        applyJsonPatch({ arr: [1] }, [{ op: 'add', path: '/arr/-', value: 2 }]),
      ).toEqual({ arr: [1, 2] });
    });

    it('allows add at index === length (insertion point)', () => {
      expect(
        applyJsonPatch({ arr: [1] }, [{ op: 'add', path: '/arr/1', value: 2 }]),
      ).toEqual({ arr: [1, 2] });
    });

    it('replaces nested values', () => {
      expect(
        applyJsonPatch({ a: { b: [{ c: 1 }] } }, [
          { op: 'replace', path: '/a/b/0/c', value: 9 },
        ]),
      ).toEqual({ a: { b: [{ c: 9 }] } });
    });

    it('replaces the whole document with path ""', () => {
      expect(
        applyJsonPatch({ old: true }, [
          { op: 'replace', path: '', value: { fresh: 1 } },
        ]),
      ).toEqual({ fresh: 1 });
    });

    it('removes object members and array elements', () => {
      expect(
        applyJsonPatch({ a: 1, arr: [1, 2, 3] }, [
          { op: 'remove', path: '/a' },
          { op: 'remove', path: '/arr/1' },
        ]),
      ).toEqual({ arr: [1, 3] });
    });

    it('applies ops sequentially (later ops see earlier results)', () => {
      expect(
        applyJsonPatch({ arr: [] as number[] }, [
          { op: 'add', path: '/arr/-', value: 1 },
          { op: 'add', path: '/arr/-', value: 2 },
          { op: 'replace', path: '/arr/0', value: 10 },
        ]),
      ).toEqual({ arr: [10, 2] });
    });

    it('rejects replace of a non-existent member with the op index', () => {
      try {
        applyJsonPatch({ a: 1 }, [
          { op: 'replace', path: '/a', value: 2 },
          { op: 'replace', path: '/ghost', value: 3 },
        ]);
        fail('expected JsonPatchError');
      } catch (error) {
        expect(error).toBeInstanceOf(JsonPatchError);
        expect((error as JsonPatchError).opIndex).toBe(1);
      }
    });

    it('rejects remove of a non-existent member', () => {
      expect(() =>
        applyJsonPatch({}, [{ op: 'remove', path: '/ghost' }]),
      ).toThrow(JsonPatchError);
    });

    it('rejects out-of-bounds array indices', () => {
      expect(() =>
        applyJsonPatch({ arr: [1] }, [
          { op: 'replace', path: '/arr/5', value: 0 },
        ]),
      ).toThrow(/out of bounds/);
      expect(() =>
        applyJsonPatch({ arr: [1] }, [{ op: 'add', path: '/arr/3', value: 0 }]),
      ).toThrow(/out of bounds/);
    });

    it('rejects non-numeric and leading-zero array indices', () => {
      expect(() =>
        applyJsonPatch({ arr: [1] }, [{ op: 'remove', path: '/arr/x' }]),
      ).toThrow(/Invalid array index/);
      expect(() =>
        applyJsonPatch({ arr: [1, 2] }, [{ op: 'remove', path: '/arr/01' }]),
      ).toThrow(/Invalid array index/);
    });

    it('rejects unsupported ops (move/copy/test are out of the subset)', () => {
      expect(() =>
        applyJsonPatch({}, [{ op: 'move' as any, path: '/a', value: 1 }]),
      ).toThrow(/Unsupported op/);
    });

    it('rejects add/replace without a value', () => {
      expect(() =>
        applyJsonPatch({}, [{ op: 'add', path: '/a' } as any]),
      ).toThrow(/requires a value/);
    });

    it('rejects removing the whole document', () => {
      expect(() => applyJsonPatch({}, [{ op: 'remove', path: '' }])).toThrow(
        /whole document/,
      );
    });

    it('rejects paths that traverse missing parents', () => {
      expect(() =>
        applyJsonPatch({ a: {} }, [{ op: 'add', path: '/a/b/c', value: 1 }]),
      ).toThrow(/does not exist/);
    });

    it('rejects paths that traverse scalars', () => {
      expect(() =>
        applyJsonPatch({ a: 1 }, [{ op: 'add', path: '/a/b', value: 1 }]),
      ).toThrow(/non-container/);
    });
  });

  describe('resolveJsonPointer', () => {
    const doc = { technicalPlan: { repos: [{ repo: 'ally-be' }] }, a: 0 };

    it('reads objects, arrays and the whole document', () => {
      expect(resolveJsonPointer(doc, '/technicalPlan/repos/0/repo')).toBe(
        'ally-be',
      );
      expect(resolveJsonPointer(doc, '/technicalPlan/repos')).toEqual([
        { repo: 'ally-be' },
      ]);
      expect(resolveJsonPointer(doc, '')).toBe(doc);
      // Present and falsy is not the same as absent.
      expect(resolveJsonPointer(doc, '/a')).toBe(0);
    });

    it('answers undefined rather than throwing for a path that addresses nothing', () => {
      // The caller is showing a model what landed where it just wrote; "there
      // is nothing there" is the useful answer, not an exception.
      expect(
        resolveJsonPointer(doc, '/technicalPlan/repos/9/repo'),
      ).toBeUndefined();
      expect(resolveJsonPointer(doc, '/nope/deeper')).toBeUndefined();
      expect(resolveJsonPointer(doc, '/a/b')).toBeUndefined();
      expect(
        resolveJsonPointer(doc, '/technicalPlan/repos/last'),
      ).toBeUndefined();
    });
  });
});
