import {
  mediaOverrideItemId,
  mediaOverrideKey,
} from '../track-translation.type';

const ITEM = '11111111-1111-1111-1111-111111111111';
const QUESTION = '22222222-2222-2222-2222-222222222222';

describe('media override keys', () => {
  it('keys a component-level override by the item alone', () => {
    expect(mediaOverrideKey(ITEM)).toBe(ITEM);
    expect(mediaOverrideKey(ITEM, null)).toBe(ITEM);
    expect(mediaOverrideKey(ITEM, undefined)).toBe(ITEM);
  });

  it('keys a question-level override by item then question', () => {
    expect(mediaOverrideKey(ITEM, QUESTION)).toBe(`${ITEM}::${QUESTION}`);
  });

  /**
   * The orphan sweep deletes any override whose item is gone. It can only do
   * that if every key still starts with the item id — which is why the item
   * comes first and why this is pinned.
   */
  it('recovers the item id from either form', () => {
    expect(mediaOverrideItemId(mediaOverrideKey(ITEM))).toBe(ITEM);
    expect(mediaOverrideItemId(mediaOverrideKey(ITEM, QUESTION))).toBe(ITEM);
  });

  it('is stable across calls, since the key is persisted as a jsonb key', () => {
    expect(mediaOverrideKey(ITEM, QUESTION)).toBe(
      mediaOverrideKey(ITEM, QUESTION),
    );
  });
});
