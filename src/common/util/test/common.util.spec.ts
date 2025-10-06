import { CommonUtil } from '../common.util';

describe('CommonUtil', () => {
  describe('hasExactKeys', () => {
    it('should return false when obj or reference is null/undefined', () => {
      expect(CommonUtil.hasExactKeys(null, { a: 1 })).toBe(false);
      expect(CommonUtil.hasExactKeys({ a: 1 }, null)).toBe(false);
      expect(CommonUtil.hasExactKeys(undefined, { a: 1 })).toBe(false);
    });

    it('should return true when objects have exact same keys', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { b: 3, a: 4 };

      const result = CommonUtil.hasExactKeys(obj1, obj2);

      expect(result).toBe(true);
    });
  });

  describe('difference', () => {
    it('should return empty array when obj or reference is null/undefined', () => {
      expect(CommonUtil.difference(null as any, { a: 1 })).toEqual([]);
      expect(CommonUtil.difference({ a: 1 }, null as any)).toEqual([]);
    });

    it('should return difference between object keys', () => {
      const obj = { a: 1, b: 2, c: 3 };
      const reference = { a: 1, b: 2 };

      const result = CommonUtil.difference(obj, reference);

      expect(result).toEqual(['c']);
    });
  });

  describe('getInvalidKeys', () => {
    it('should return keys that are not in object', () => {
      const obj = { a: 1, b: 2 };
      const keys = ['a', 'c', 'd'];

      const result = CommonUtil.getInvalidKeys(obj, keys);

      expect(result).toEqual(['c', 'd']);
    });
  });

  describe('getInvalidKeysFromSet', () => {
    it('should return keys that are not in set', () => {
      const set = new Set(['a', 'b']);
      const keys = ['a', 'c', 'd'];

      const result = CommonUtil.getInvalidKeysFromSet(set, keys);

      expect(result).toEqual(['c', 'd']);
    });
  });

  describe('setKeysToValue', () => {
    it('should set existing keys to specified value', () => {
      const obj = { a: 1, b: 2, c: 3 };
      const keys = ['a', 'c', 'd'];
      const value = 'test';

      const result = CommonUtil.setKeysToValue(obj, keys, value);

      expect(result).toEqual({ a: 'test', b: 2, c: 'test' });
      expect(obj).toEqual({ a: 'test', b: 2, c: 'test' }); // Should mutate original
    });
  });

  describe('removeFalseValues', () => {
    it('should remove keys with false values', () => {
      const obj = { a: true, b: false, c: 'test', d: false };

      const result = CommonUtil.removeFalseValues(obj);

      expect(result).toEqual({ a: true, c: 'test' });
    });
  });

  describe('removeHiddenFields', () => {
    it('should remove specified hidden fields', () => {
      const obj = { a: 1, b: 2, c: 3, d: 4 };
      const hiddenFields = ['b', 'd'];

      const result = CommonUtil.removeHiddenFields(obj, hiddenFields);

      expect(result).toEqual({ a: 1, c: 3 });
    });
  });

  describe('convertToCamelCase', () => {
    it('should return undefined for null/undefined input', () => {
      expect(CommonUtil.convertToCamelCase(null as any)).toBeUndefined();
      expect(CommonUtil.convertToCamelCase(undefined)).toBeUndefined();
    });

    it('should throw error for non-object input', () => {
      expect(() => CommonUtil.convertToCamelCase('string' as any)).toThrow(
        'Input must be an object',
      );
      expect(() => CommonUtil.convertToCamelCase([] as any)).toThrow(
        'Input must be an object',
      );
    });

    it('should convert object keys to camelCase', () => {
      const input = { first_name: 'John', last_name: 'Doe', user_id: 123 };

      const result = CommonUtil.convertToCamelCase(input);

      expect(result).toEqual({
        firstName: 'John',
        lastName: 'Doe',
        userId: 123,
      });
    });
  });

  describe('generateQueryParams', () => {
    it('should generate query string from object', () => {
      const params = { name: 'John Doe', age: 30, city: 'New York' };

      const result = CommonUtil.generateQueryParams(params);

      expect(result).toBe('name=John%20Doe&age=30&city=New%20York');
    });
  });
});
