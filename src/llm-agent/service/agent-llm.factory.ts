import { BadRequestException, Injectable } from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import {
  canonicalProvider,
  LLM_MODEL_REGISTRY,
} from 'src/llm/constants/llm-model-registry.constants';
import { AnthropicAgentProvider } from '../provider/anthropic-agent.provider';
import { GeminiAgentProvider } from '../provider/gemini-agent.provider';
import { IAgentLlmProvider } from '../provider/agent-llm-provider.interface';
import { OpenAiAgentProvider } from '../provider/openai-agent.provider';

/**
 * Providers that can run a streamed tool-use loop from ally-be.
 *
 * Narrower than `LlmProviderName`: `ollama` and `vllm` live inside the voice
 * runtime's network and ally-be has no client for either, the same reason the
 * LLM preview reports them as un-testable from here.
 */
export enum AgentLlmProviderName {
  ANTHROPIC = 'anthropic',
  OPENAI = 'openai',
  GEMINI = 'gemini',
}

const AGENT_PROVIDERS = new Set<string>(Object.values(AgentLlmProviderName));

/** Model-id shapes each provider ships, for models not in the catalog yet. */
const MODEL_PREFIXES: [RegExp, AgentLlmProviderName][] = [
  [/^claude[-.]/i, AgentLlmProviderName.ANTHROPIC],
  [/^(gpt|o\d)[-.]/i, AgentLlmProviderName.OPENAI],
  [/^gemini[-.]/i, AgentLlmProviderName.GEMINI],
];

/**
 * Which provider runs a given model id.
 *
 * Catalog first, model-id shape second. The heuristic is not a guess for its
 * own sake — it is what stops a model added to the picker before this code
 * knows about it from failing with "unsupported provider" when its name says
 * plainly who runs it. Callers that know the provider (a prompt row, an env
 * var) pass it explicitly and never reach here.
 */
export const providerForModel = (
  model: string,
): AgentLlmProviderName | undefined => {
  const id = String(model ?? '').trim();
  if (!id) {
    return undefined;
  }

  const catalogued = LLM_MODEL_REGISTRY.find((entry) => entry.model === id);
  if (catalogued && AGENT_PROVIDERS.has(catalogued.provider)) {
    return catalogued.provider as AgentLlmProviderName;
  }

  return MODEL_PREFIXES.find(([pattern]) => pattern.test(id))?.[1];
};

/** Canonical agent-capable provider name, or undefined for anything else. */
export const normaliseAgentProvider = (
  provider: string | undefined | null,
): AgentLlmProviderName | undefined => {
  const name = canonicalProvider(provider);
  return AGENT_PROVIDERS.has(name) ? (name as AgentLlmProviderName) : undefined;
};

/**
 * Builds the provider adapter for one agentic turn.
 *
 * Every rejection here is misconfiguration an admin can act on — an unknown
 * provider, a model nothing claims, a key this environment doesn't hold — so
 * each one says which of those it is rather than surfacing as a generic
 * failure at the call site.
 */
@Injectable()
export class AgentLlmProviderFactory {
  constructor(private readonly configService: AppConfigService) {}

  create(provider: string, model: string): IAgentLlmProvider {
    const normalised = normaliseAgentProvider(provider);
    if (!normalised) {
      throw new BadRequestException(
        `"${provider}" cannot run an AI agent from this service. ` +
          `Choose one of: ${Object.values(AgentLlmProviderName).join(', ')}.`,
      );
    }

    if (!model?.trim()) {
      throw new BadRequestException(
        `No model is configured for ${normalised}, so there is nothing to run.`,
      );
    }

    const apiKey = this.apiKeyFor(normalised);
    if (!apiKey) {
      throw new BadRequestException(
        `${normalised} is not configured on this environment (no API key), ` +
          'so it cannot be used. Please contact your administrator.',
      );
    }

    switch (normalised) {
      case AgentLlmProviderName.ANTHROPIC:
        return new AnthropicAgentProvider(apiKey);
      case AgentLlmProviderName.OPENAI:
        return new OpenAiAgentProvider(apiKey);
      case AgentLlmProviderName.GEMINI:
        return new GeminiAgentProvider(apiKey);
      default: {
        const exhaustive: never = normalised;
        throw new BadRequestException(`Unsupported provider: ${exhaustive}`);
      }
    }
  }

  /** Whether a provider is usable here — for callers picking a fallback. */
  isConfigured(provider: string): boolean {
    const normalised = normaliseAgentProvider(provider);
    return Boolean(normalised && this.apiKeyFor(normalised));
  }

  private apiKeyFor(provider: AgentLlmProviderName): string | undefined {
    switch (provider) {
      case AgentLlmProviderName.ANTHROPIC:
        return this.configService.anthropic.apiKey;
      case AgentLlmProviderName.OPENAI:
        return this.configService.openai.apiKey;
      case AgentLlmProviderName.GEMINI:
        return this.configService.gemini.apiKey;
      default:
        return undefined;
    }
  }
}
