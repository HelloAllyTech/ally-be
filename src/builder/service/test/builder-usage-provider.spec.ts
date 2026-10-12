import { usageProviderFor } from '../builder-build.service';

/**
 * Which provider a build's usage row is filed under.
 *
 * Builder runs Gemini through opencode, which can report usage under its own
 * `provider/model` form. The old fallback was a literal 'anthropic', so an id
 * the prefix match did not recognise filed Gemini spend under Claude.
 */
describe('usageProviderFor', () => {
  it('reads a bare Gemini id as gemini', () => {
    expect(usageProviderFor('gemini-2.5-pro')).toBe('gemini');
  });

  it("reads opencode's provider-prefixed id the same way", () => {
    expect(usageProviderFor('google/gemini-2.5-pro')).toBe('gemini');
  });

  it("keeps the Gemini SDK's models/ prefix working", () => {
    expect(usageProviderFor('models/gemini-2.5-flash')).toBe('gemini');
  });

  it('files an id nothing recognises as unknown, never as a vendor', () => {
    expect(usageProviderFor('some-new-model')).toBe('unknown');
    expect(usageProviderFor('acme/some-new-model')).toBe('unknown');
  });
});
