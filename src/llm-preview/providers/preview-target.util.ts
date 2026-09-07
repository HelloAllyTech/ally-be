import { BadRequestException } from '@nestjs/common';
import { canonicalProvider } from 'src/llm/constants/llm-model-registry.constants';

/**
 * Providers this preview can call.
 *
 * `LLM_CONFIG_SCHEMA` accepts `openai | google | gemini | ollama | vllm` while
 * the model catalog uses `openai | gemini | anthropic`. The two spellings of
 * Gemini are reconciled by the shared `canonicalProvider` helper rather than
 * locally here — see the alias note in llm-model-registry.constants.ts.
 */
export enum PreviewableLlmProvider {
  OPENAI = 'openai',
  GEMINI = 'gemini',
  ANTHROPIC = 'anthropic',
}

/** Providers that exist in config but cannot be previewed from ally-be. */
const LOCAL_ONLY_PROVIDERS = new Set(['ollama', 'vllm']);

export const normaliseProvider = (
  provider: string | undefined,
): PreviewableLlmProvider | undefined => {
  const name = canonicalProvider(provider);
  return (Object.values(PreviewableLlmProvider) as string[]).includes(name)
    ? (name as PreviewableLlmProvider)
    : undefined;
};

/**
 * Rejects a target this preview cannot test, before any SDK is involved.
 *
 * This validation stayed behind when the preview's three provider adapters were
 * folded into the shared `llm-agent` ones. The execution was duplication; these
 * messages are not. Each one is read by an admin who just pressed a button and
 * has to work out what to do next, and the shared factory's equivalents are
 * written for an agent loop — "cannot run an AI agent from this service" is
 * true but unhelpful next to a Test button.
 *
 * Misconfiguration throws; a provider REJECTING the call does not. That split
 * is the whole contract of this feature: the button exists to surface "this
 * model no longer works" as readable text, so a 404 from the vendor is a
 * successful preview with `ok: false`, while a missing key here is our bug and
 * raises.
 */
export const assertPreviewable = (
  provider: string | undefined,
  model: string,
): PreviewableLlmProvider => {
  const rawName = String(provider ?? '')
    .trim()
    .toLowerCase();

  if (LOCAL_ONLY_PROVIDERS.has(rawName)) {
    throw new BadRequestException(
      `${rawName} runs inside the voice runtime, not this service, so it cannot be previewed from here.`,
    );
  }

  const normalised = normaliseProvider(provider);
  if (!normalised) {
    throw new BadRequestException(
      `Unsupported LLM provider "${provider}". Previewable providers: ${Object.values(
        PreviewableLlmProvider,
      ).join(', ')}.`,
    );
  }

  if (!model?.trim()) {
    throw new BadRequestException(
      'This config has no model set, so there is nothing to test.',
    );
  }

  return normalised;
};
