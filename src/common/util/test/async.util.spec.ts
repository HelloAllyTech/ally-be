import { processSequentially } from '../async.util';

describe('AsyncUtil', () => {
  describe('processSequentially', () => {
    it('should process items sequentially and return results', async () => {
      const items = [1, 2, 3];
      const asyncCallback = jest
        .fn()
        .mockImplementation((item, index) => Promise.resolve(item * 2 + index));

      const result = await processSequentially(items, asyncCallback);

      expect(asyncCallback).toHaveBeenCalledTimes(3);
      expect(asyncCallback).toHaveBeenNthCalledWith(1, 1, 0);
      expect(asyncCallback).toHaveBeenNthCalledWith(2, 2, 1);
      expect(asyncCallback).toHaveBeenNthCalledWith(3, 3, 2);
      expect(result).toEqual([2, 5, 8]); // (1*2+0), (2*2+1), (3*2+2)
    });
  });
});
