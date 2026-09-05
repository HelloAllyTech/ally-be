/**
 * Live check that the agent LLM adapters actually work against each provider.
 *
 * Unit tests drive fakes, so they prove the mapping is what we *think* each API
 * wants. Only a real call proves the API agrees — a rejected tool schema or a
 * mis-shaped tool result is a 400 that no fake can produce.
 *
 * Runs the real character-interview tool definitions through two round-trips:
 * a first pass that should come back wanting `ask_question`, then the tool
 * result fed back so the model continues. That second pass is the part that
 * breaks, because it is where each provider's tool-result shape differs.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/verify-agent-llm-providers.ts
 *
 * Spends real tokens (a few cents). Needs ANTHROPIC_API_KEY / OPENAI_API_KEY /
 * GEMINI_API_KEY in ally-be/.env; providers without a key are skipped.
 */
import * as dotenv from 'dotenv';
import { AnthropicAgentProvider } from 'src/llm-agent/provider/anthropic-agent.provider';
import { GeminiAgentProvider } from 'src/llm-agent/provider/gemini-agent.provider';
import { OpenAiAgentProvider } from 'src/llm-agent/provider/openai-agent.provider';
import { IAgentLlmProvider } from 'src/llm-agent/provider/agent-llm-provider.interface';
import {
  AgentMessage,
  AgentTurnResult,
} from 'src/llm-agent/type/agent-llm.type';
import { CharacterInterviewToolsService } from 'src/scenario-character/service/character-interview-tools.service';

dotenv.config();

const SYSTEM =
  'You are a character-profile interviewer. Ask the admin ONE question at a ' +
  'time using the ask_question tool (always with allowCustom=true), building ' +
  'a rich character. Never ask two questions in one turn.';

const tools = new CharacterInterviewToolsService(
  null as any,
  null as any,
).getToolDefinitions();

/** Mirrors the orchestrator's retry so a transient malformed call isn't a fail. */
const runWithRetries = async (
  provider: IAgentLlmProvider,
  model: string,
  messages: AgentMessage[],
): Promise<AgentTurnResult> => {
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    const result = await run(provider, model, messages);
    if (result.stopReason !== 'invalid_tool_call') {
      return result;
    }
    console.log(`   retry   unreadable tool call (attempt ${attempt + 1})`);
  }
  throw new Error('unreadable tool call on every attempt');
};

const run = async (
  provider: IAgentLlmProvider,
  model: string,
  messages: AgentMessage[],
): Promise<AgentTurnResult> => {
  let final: AgentTurnResult | undefined;
  let streamed = '';
  for await (const event of provider.stream({
    model,
    system: SYSTEM,
    messages,
    maxTokens: 2000,
    tools,
  })) {
    if (event.type === 'text_delta') {
      streamed += event.text;
    } else {
      final = event.message;
    }
  }
  if (!final) {
    throw new Error('no final message');
  }
  // Streamed text must equal the assembled text, or the SSE the admin watched
  // is not the message that got persisted.
  const assembled = final.content
    .filter((block): block is any => block.type === 'text')
    .map((block) => block.text)
    .join('');
  if (streamed !== assembled) {
    throw new Error(
      `streamed text != final text\n  streamed: ${JSON.stringify(streamed)}\n  final:    ${JSON.stringify(assembled)}`,
    );
  }
  return final;
};

const check = async (
  label: string,
  provider: IAgentLlmProvider,
  model: string,
) => {
  process.stdout.write(`\n── ${label} (${model})\n`);

  const messages: AgentMessage[] = [
    {
      role: 'user',
      content:
        'Start the interview for a character who calls a mental-health helpline.',
    },
  ];

  const first = await runWithRetries(provider, model, messages);
  const call = first.content.find((block) => block.type === 'tool_use') as any;
  console.log(
    `   pass 1  stop=${first.stopReason} tokens=${first.usage.inputTokens}/${first.usage.outputTokens}`,
  );
  if (!call) {
    throw new Error(
      `expected a tool call, got: ${JSON.stringify(first.content).slice(0, 300)}`,
    );
  }
  console.log(`   tool    ${call.name} id=${call.id}`);
  console.log(`   args    ${JSON.stringify(call.input).slice(0, 160)}`);
  if (call.name !== 'ask_question' || !call.input?.prompt) {
    throw new Error('tool call did not carry a usable question');
  }

  // Feed the result back — the round-trip each provider spells differently.
  messages.push({ role: 'assistant', content: first.content });
  messages.push({
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: call.id,
        content: JSON.stringify({
          ok: true,
          questionId: 'q-1',
          note: 'Question delivered; the admin will answer next.',
        }),
      },
    ],
  });
  messages.push({
    role: 'user',
    content: '[answers question q-1] Her name is Asha and she is 34.',
  });

  const second = await runWithRetries(provider, model, messages);
  const nextCall = second.content.find(
    (block) => block.type === 'tool_use',
  ) as any;
  console.log(
    `   pass 2  stop=${second.stopReason} tokens=${second.usage.inputTokens}/${second.usage.outputTokens}`,
  );
  console.log(`   tool    ${nextCall?.name ?? '(none)'}`);
  if (second.stopReason !== 'tool_use' || nextCall?.name !== 'ask_question') {
    throw new Error(
      `expected a second ask_question after the tool result, got stop=${second.stopReason}`,
    );
  }
  console.log(`   ✅ ${label} round-trips`);
};

const main = async () => {
  const targets: [
    string,
    () => IAgentLlmProvider,
    string,
    string | undefined,
  ][] = [
    [
      'anthropic',
      () => new AnthropicAgentProvider(process.env.ANTHROPIC_API_KEY!),
      'claude-sonnet-4-6',
      process.env.ANTHROPIC_API_KEY,
    ],
    [
      'openai',
      () => new OpenAiAgentProvider(process.env.OPENAI_API_KEY!),
      process.env.VERIFY_OPENAI_MODEL ?? 'gpt-4.1',
      process.env.OPENAI_API_KEY,
    ],
    [
      'gemini',
      () =>
        new GeminiAgentProvider(
          (process.env.GEMINI_API_KEY ??
            process.env.GOOGLE_GENERATIVE_AI_API_KEY)!,
        ),
      process.env.VERIFY_GEMINI_MODEL ?? 'gemini-2.5-flash',
      process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    ],
  ];

  const failures: string[] = [];
  for (const [label, make, model, key] of targets) {
    if (!key) {
      console.log(`\n── ${label}: skipped (no API key)`);
      continue;
    }
    try {
      await check(label, make(), model);
    } catch (error) {
      failures.push(label);
      console.error(
        `   ❌ ${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (failures.length) {
    console.error(`\nFailed: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('\nAll configured providers round-trip.\n');
};

void main();
