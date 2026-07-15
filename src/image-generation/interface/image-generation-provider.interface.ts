/** Landscape default matching the admin dashboard's 16:9 cover-image slots. */
export const DEFAULT_IMAGE_SIZE = '1536x1024';

export enum ImageGenerationProviderType {
  OPENAI = 'openai',
  GEMINI = 'gemini',
}

/**
 * Common surface for text-to-image providers, mirroring the LlmProvider /
 * LlmProviderFactory shape used by the coaching chat. Providers return raw
 * PNG bytes so callers own storage (S3) and URL semantics.
 */
export interface ImageGenerationProvider {
  /** Model id the provider will invoke — used for usage analytics. */
  getModel(): string;

  /** Throws if the provider's API key is not configured. */
  assertConfigured(): void;

  /**
   * Generate one image for the prompt. `size` is a WIDTHxHEIGHT string
   * (e.g. '1536x1024'); providers that only accept aspect ratios map it.
   */
  generateImage(prompt: string, size: string): Promise<Buffer>;
}
