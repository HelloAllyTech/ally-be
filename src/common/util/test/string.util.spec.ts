import { StringUtil } from '../string.util';

describe('StringUtil', () => {
  describe('wordCount', () => {
    it('should return 0 when no words are found', () => {
      const result = StringUtil.wordCount('');

      expect(result).toBe(0);
    });

    it('should return 0 when only special characters', () => {
      const result = StringUtil.wordCount('!@#$%^&*()');

      expect(result).toBe(0);
    });

    it('should count words correctly', () => {
      const result = StringUtil.wordCount('Hello world! This is a test.');

      expect(result).toBe(6);
    });

    it('should handle words with apostrophes', () => {
      const result = StringUtil.wordCount("It's a beautiful day, isn't it?");

      expect(result).toBe(6);
    });

    it('should handle mixed content', () => {
      const result = StringUtil.wordCount('Hello123 world! @#$ test');

      expect(result).toBe(3);
    });
  });
});
