/** Landscape default matching the admin dashboard's 16:9 cover-image slots. */
export const DEFAULT_IMAGE_SIZE = '1536x1024';

/** OpenAI image quality tiers; providers without one ignore it. */
export type ImageQuality = 'low' | 'medium' | 'high';

/**
 * Quality for images a person is waiting on in the editor (the roleplay and
 * course cover buttons). gpt-image-1's default took 79–95 s in production and
 * 74 s locally at 1536x1024; medium took 25 s and low 14 s on the same prompt
 * (2026-10-20), with no difference worth paying for at course-card size.
 * Background jobs (Course Copilot) don't pass one and keep the default.
 */
export const INTERACTIVE_IMAGE_QUALITY: ImageQuality = 'medium';

export interface ImageGenerationOptions {
  quality?: ImageQuality;
}

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
  generateImage(
    prompt: string,
    size: string,
    options?: ImageGenerationOptions,
  ): Promise<Buffer>;
}
