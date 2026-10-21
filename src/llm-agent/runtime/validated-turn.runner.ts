import { LoggerService } from 'src/logger/logger.service';
import {
  AgentContentBlock,
  AgentStreamRequest,
  AgentToolDefinition,
  AgentTurnResult,
} from '../type/agent-llm.type';
import {
  AgentReplyProblem,
  AgentToolOutcome,
  AgentTurnFrame,
  ValidatedTurnAgent,
  ValidatedTurnState,
} from './agent-turn.types';
import {
  clipText,
  describeToolFailure,
  joinCallsToResults,
} from './agent-turn-receipt.util';

/**
 * A validated turn: the reply reaches the person only once it is true.
 *
 * Builder's interview proved this out (W2a, builder_settings.validatedTurns);
 * this is the same loop for every other agent that talks to someone and
 * changes something for them. A turn ends only through the agent's asking
 * tool (a question card) or its closing tool (no question), and that call is
 * checked before anything is shown. It is sent back to the model — not
 * delivered, the model told why, the loop going on — when the same step held
 * a call that failed or a lookup whose result the model had not read yet;
 * when an earlier edit failed and nothing repaired it; when the message says
 * something changed and nothing did; when the agent's own checks disagree with
 * the message; or when the person's words changed nothing and the model did
 * not say why. Each problem holds a reply back once: raised again, it goes out
 * as a warning on the receipt rather than looping. After two rejections the
 * next step can only edit and end the turn, and whatever it sends is
 * delivered with what it still gets wrong listed under it.
 *
 * A tool that wants the turn over (a confirmation it asked for, a blueprint
 * it put up for review, a draft it saved) does not end it by itself: its
 * question is held, the next step can only close the turn, and the person
 * reads the closing message above the card — a message the runner checked.
 *
 * Nothing the model writes outside the ending call is shown; it is kept as
 * working notes. The retries every agent loop learned the hard way — a pass
 * cut off at the output cap, an unreadable tool call, an empty pass — are
 * kept as they were.
 */

const logger = LoggerService.getInstance('ValidatedTurnRunner');

/**
 * Replies sent back before the next goes out regardless, with what it still
 * gets wrong on the receipt. Two: one problem per attempt is the common case,
 * and a third attempt costs the person more waiting than a reply with a
 * warning under it. Builder's number, for the same reason.
 */
export const VALIDATED_TURN_MAX_REJECTIONS = 2;

/** On the receipt when the reply had to be the model's own notes. */
export const PROSE_FALLBACK_WARNING = (agentName: string): string =>
  `${agentName} didn't end the turn with a reply, so its working notes are shown instead.`;

/** The ending tools, quoted for the model. */
const endingList = (agent: ValidatedTurnAgent): string =>
  `\`${agent.askingTool}\` or \`${agent.closingTool}\``;

const isQuestionFrame = (frame: AgentTurnFrame): boolean =>
  frame.event === 'question';

/** One provider round-trip, consumed silently: nothing streams until the reply is checked. */
async function runPass(
  agent: ValidatedTurnAgent,
  request: AgentStreamRequest,
): Promise<AgentTurnResult> {
  let result: AgentTurnResult | null = null;
  for await (const event of agent.provider.stream(request)) {
    if (event.type !== 'text_delta') result = event.message;
  }
  if (!result) {
    // Every adapter ends with a `final`; one that did not would otherwise
    // read as a normal empty pass and be settled as one.
    throw new Error(
      `The ${agent.provider.name} model returned no response for this turn.`,
    );
  }
  return result;
}

/** Run one tool, turning a throw into a result the model can repair from. */
async function executeTool(
  agent: ValidatedTurnAgent,
  name: string,
  input: Record<string, any>,
): Promise<AgentToolOutcome> {
  try {
    return await agent.execute(name, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`${agent.logTag} tool "${name}" failed: ${message}`);
    return {
      modelResult: { ok: false, error: 'tool_failed', message },
      summary: `${name} failed`,
    };
  }
}

/**
 * Deliver frames held back during the turn. For a turn that ends without a
 * reply (an error, a provider failure): a confirmation a tool already asked
 * for is waiting on the person's answer, so its card must still reach them.
 */
export function* flushHeldFrames(
  turn: ValidatedTurnState,
): Generator<AgentTurnFrame> {
  const held = turn.held.splice(0);
  for (const frame of held) {
    if (isQuestionFrame(frame)) turn.questions.push(frame.data);
    yield frame;
  }
}

export async function* runValidatedTurn(
  agent: ValidatedTurnAgent,
  turn: ValidatedTurnState,
): AsyncGenerator<AgentTurnFrame> {
  const { messages, maxIterations, maxRetries } = agent;
  // Prose without an ending call: nudged once with every tool still on offer
  // (it may need to edit first), then offered only the ending tools.
  let nudged = false;
  let mustEnd = false;
  // Room for the retries (unreadable calls, empty passes, truncation), each
  // bounded by its own counter, on top of the iteration cap.
  const hardStop = maxIterations + 2 * maxRetries;
  const endingNames = new Set([agent.askingTool, agent.closingTool]);

  for (let iteration = 0; iteration < hardStop; iteration++) {
    turn.iterations = iteration + 1;
    const tools = agent.tools();
    const lastPass = mustEnd || iteration >= maxIterations - 1;
    const lenient = turn.rejections >= VALIDATED_TURN_MAX_REJECTIONS;
    const offered: AgentToolDefinition[] = turn.endRequestedBy
      ? // A tool already asked for the turn to end: the reply is all that is left.
        tools.filter((tool) => tool.name === agent.closingTool)
      : lastPass
        ? tools.filter((tool) => endingNames.has(tool.name))
        : lenient
          ? tools.filter(
              (tool) => endingNames.has(tool.name) || agent.isEdit(tool.name),
            )
          : tools;

    const finalMessage = await runPass(agent, {
      model: agent.model,
      maxTokens: agent.maxTokens,
      system: agent.system,
      messages,
      tools: offered,
    });
    turn.stopReason = finalMessage.stopReason;
    agent.recordUsage(finalMessage.usage, turn.iterations);

    if (turn.stopReason === 'invalid_tool_call') {
      if (turn.invalidToolCalls >= maxRetries) {
        logger.warn(
          `${agent.logTag} unreadable tool call ${turn.invalidToolCalls + 1} times; giving up.`,
        );
        yield fail(turn, agent.errors.invalidToolCall);
        return;
      }
      turn.invalidToolCalls += 1;
      logger.warn(
        `${agent.logTag} unreadable tool call; retrying (${turn.invalidToolCalls}/${maxRetries}).`,
      );
      continue;
    }

    const contentBlocks: AgentContentBlock[] = finalMessage.content ?? [];
    // Whitespace is not a reply: Gemini's empty STOP arrives as a bare "\n".
    const textBlocks = contentBlocks.filter(
      (block): block is Extract<AgentContentBlock, { type: 'text' }> =>
        block?.type === 'text' && Boolean(block.text?.trim()),
    );
    const passText = textBlocks
      .map((block) => String(block.text).trim())
      .join('\n\n');
    const toolUses = contentBlocks.filter(
      (block): block is Extract<AgentContentBlock, { type: 'tool_use' }> =>
        block?.type === 'tool_use',
    );
    if (passText) turn.workingNotes.push(passText);

    if (turn.stopReason === 'max_tokens') {
      // Its tool calls are fragments the SDK reconstructed by partial parse;
      // running one would apply an arbitrary piece of what the model meant.
      turn.truncations += 1;
      if (turn.truncations > maxRetries) {
        logger.error(
          `${agent.logTag} output still truncated at ${agent.maxTokens} tokens after ` +
            `${maxRetries} retries; ending the turn.`,
        );
        yield fail(turn, agent.errors.truncated);
        return;
      }
      logger.warn(
        `${agent.logTag} output truncated at ${agent.maxTokens} tokens (retry ` +
          `${turn.truncations}/${maxRetries}, ${toolUses.length} tool call(s) discarded).`,
      );
      await agent.checkpoint(false);
      // Only the completed text is replayed: a truncated tool_use has no
      // result to pair it with, and every provider rejects a dangling one.
      if (textBlocks.length) {
        messages.push({ role: 'assistant', content: textBlocks });
      }
      messages.push({ role: 'user', content: agent.truncationNudge });
      continue;
    }

    if (toolUses.length === 0) {
      // Nothing at all: the same request again — the model is
      // non-deterministic and the transcript is unchanged.
      if (!passText && turn.emptyPasses < maxRetries) {
        turn.emptyPasses += 1;
        logger.warn(
          `${agent.logTag} empty pass; retrying (${turn.emptyPasses}/${maxRetries}).`,
        );
        continue;
      }
      if (!lastPass) {
        // Ended in prose. Nothing outside an ending call reaches the person,
        // so ask for one — kept in the history, so the next pass can turn its
        // own notes into the message.
        if (textBlocks.length) {
          messages.push({ role: 'assistant', content: textBlocks });
        }
        messages.push({
          role: 'user',
          content: nudged
            ? `End the turn now with ${endingList(agent)}; nothing else will run this turn.`
            : `The ${agent.userNoun} has not seen that — only the \`message\` of ` +
              `${endingList(agent)} reaches them. Finish what the turn needs (edits ` +
              'included), then end it with one of those.',
        });
        if (nudged) mustEnd = true;
        nudged = true;
        continue;
      }
      // Still prose with only the ending tools on offer. Its notes are shown
      // rather than nothing, and the receipt says so.
      const fallback =
        passText || turn.workingNotes[turn.workingNotes.length - 1] || '';
      if (fallback) {
        yield* deliverReply(agent, turn, null, fallback, [
          PROSE_FALLBACK_WARNING(agent.agentName),
        ]);
      }
      return;
    }

    // The notes of this pass are saved before the tools run.
    await agent.checkpoint(false);
    messages.push({ role: 'assistant', content: contentBlocks });

    const endings = toolUses.filter((use) => endingNames.has(String(use.name)));
    const others = toolUses.filter((use) => !endingNames.has(String(use.name)));
    const offeredNames = new Set(offered.map((tool) => String(tool.name)));
    const results = new Map<string, Record<string, any>>();
    yield* runCalls(agent, turn, others, offeredNames, results);

    const answer = (extra: Record<string, Record<string, any>> = {}) =>
      messages.push({
        role: 'user',
        content: toolUses.map((use) => ({
          type: 'tool_result' as const,
          tool_use_id: use.id,
          content: JSON.stringify(extra[use.id] ?? results.get(use.id) ?? {}),
        })),
      });

    if (!endings.length) {
      answer();
      continue;
    }

    // One reply per turn. A second ending call in the same step is dropped —
    // usually a second question, which belongs in the next turn.
    const [ending, ...extraEndings] = endings;
    const dropped: Record<string, Record<string, any>> = {};
    for (const extra of extraEndings) {
      dropped[extra.id] = {
        ok: false,
        delivered: false,
        error: 'one_reply_per_turn',
        message:
          'Only the first turn-ending call in a step counts; this one was dropped. Ask ' +
          `the next question after the ${agent.userNoun} answers.`,
      };
      turn.toolCalls.push({
        id: extra.id,
        name: String(extra.name),
        input: extra.input ?? {},
      });
      turn.toolResults.push({
        toolUseId: extra.id,
        name: String(extra.name),
        result: dropped[extra.id],
      });
    }

    const input = (ending.input ?? {}) as Record<string, any>;
    const endingName = String(ending.name);
    // An ending the step was not offered (a question after a tool already
    // asked one) is sent back, whatever else is true of it.
    const notOffered = !offeredNames.has(endingName);
    const message = String(input.message ?? '').trim() || passText;
    const problems = await replyProblems(
      agent,
      turn,
      endingName,
      input,
      message,
      others,
      results,
      notOffered,
    );
    const blocking = problems.filter(
      (problem) => !turn.raised.has(problem.key),
    );

    if (blocking.length && !lenient && !lastPass) {
      turn.rejections += 1;
      problems.forEach((problem) => turn.raised.add(problem.key));
      const rejection = {
        ok: false,
        delivered: false,
        error: 'not_delivered',
        message:
          `Not delivered — the ${agent.userNoun} has not seen this turn. Fix what is ` +
          'listed, then end the turn again.',
        reasons: problems.map((problem) => problem.toModel),
      };
      turn.toolCalls.push({ id: ending.id, name: endingName, input });
      turn.toolResults.push({
        toolUseId: ending.id,
        name: endingName,
        result: rejection,
      });
      logger.info(
        `${agent.logTag} ${endingName} not delivered (${turn.rejections}): ` +
          problems.map((problem) => problem.key).join(', '),
      );
      answer({ ...dropped, [ending.id]: rejection });
      await agent.checkpoint(false);
      continue;
    }

    yield* deliverReply(
      agent,
      turn,
      ending,
      message,
      problems.map((problem) => problem.toUser),
    );
    return;
  }
}

function fail(
  turn: ValidatedTurnState,
  error: { code: string; message: string },
): AgentTurnFrame {
  turn.errored = true;
  turn.error = error.message;
  turn.errorCode = error.code;
  return { event: 'error', data: { code: error.code, message: error.message } };
}

/**
 * The calls of one step, other than the ending one. Lookups run together —
 * they only read — and are reported together; everything else runs after
 * them, one at a time and in order, because each one changes what the next
 * applies to.
 */
async function* runCalls(
  agent: ValidatedTurnAgent,
  turn: ValidatedTurnState,
  uses: Extract<AgentContentBlock, { type: 'tool_use' }>[],
  offeredNames: Set<string>,
  results: Map<string, Record<string, any>>,
): AsyncGenerator<AgentTurnFrame> {
  const hold = agent.holdUntilDelivered ?? isQuestionFrame;
  const record = function* (
    use: Extract<AgentContentBlock, { type: 'tool_use' }>,
    outcome: AgentToolOutcome,
  ): Generator<AgentTurnFrame> {
    const name = String(use.name);
    for (const frame of outcome.events ?? []) {
      agent.onToolFrame?.(frame);
      if (hold(frame)) {
        turn.held.push(frame);
      } else {
        yield frame;
      }
    }
    let modelResult = outcome.modelResult;
    if (outcome.endTurn && modelResult?.ok !== false) {
      turn.endRequestedBy = name;
      modelResult = {
        ...modelResult,
        turnEnds:
          `This ends the turn. Call \`${agent.closingTool}\` next, on its own: its ` +
          `\`message\` is what the ${agent.userNoun} reads, above anything this tool ` +
          'put in front of them.',
      };
    }
    // Recorded before the frame goes out: a person who closes the tab on
    // this frame ends the generator here, and the result is still the turn's.
    turn.toolResults.push({ toolUseId: use.id, name, result: modelResult });
    results.set(use.id, modelResult);
    yield {
      event: 'tool_result',
      data: agent.toolResultData?.(name, outcome) ?? {
        name,
        summary: outcome.summary,
      },
    };
  };
  const run = (
    use: Extract<AgentContentBlock, { type: 'tool_use' }>,
  ): Promise<AgentToolOutcome> =>
    offeredNames.has(String(use.name))
      ? executeTool(agent, String(use.name), (use.input ?? {}) as any)
      : Promise.resolve({
          modelResult: {
            ok: false,
            error: 'not_available',
            // Never ran, so it changed nothing and failed at nothing: the
            // checks below and the receipt leave it out.
            notRun: true,
            message: turn.endRequestedBy
              ? `Not run: ${turn.endRequestedBy} already ended the turn — only ` +
                `\`${agent.closingTool}\` is left.`
              : 'Not run: at this point in the turn only ending it (and editing) is available.',
          },
          summary: `${use.name} not run`,
        });
  const announce = (use: Extract<AgentContentBlock, { type: 'tool_use' }>) => {
    const name = String(use.name);
    const input = (use.input ?? {}) as Record<string, any>;
    turn.toolCalls.push({ id: use.id, name, input });
    return {
      event: 'tool_call',
      data: { name, input: agent.displayInput?.(name, input) ?? input },
    };
  };

  const lookups = uses.filter((use) => agent.isResearch(String(use.name)));
  const rest = uses.filter((use) => !lookups.includes(use));
  for (const use of lookups) yield announce(use);
  const outcomes = await Promise.all(lookups.map(run));
  for (const [index, use] of lookups.entries()) {
    yield* record(use, outcomes[index]);
  }
  if (lookups.length) await agent.checkpoint(false);

  for (const use of rest) {
    yield announce(use);
    yield* record(use, await run(use));
    await agent.checkpoint(false);
  }
}

/**
 * What is wrong with a reply, checked before it is shown. Each problem has a
 * key, so the same problem holds a reply back once (`turn.raised`), and two
 * phrasings: what the model needs to fix it, and what the person reads on the
 * receipt if the reply goes out anyway.
 */
async function replyProblems(
  agent: ValidatedTurnAgent,
  turn: ValidatedTurnState,
  endingName: string,
  input: Record<string, any>,
  message: string,
  others: Extract<AgentContentBlock, { type: 'tool_use' }>[],
  results: Map<string, Record<string, any>>,
  notOffered: boolean,
): Promise<AgentReplyProblem[]> {
  const problems: AgentReplyProblem[] = [];
  const name = agent.agentName;
  const user = agent.userNoun;
  const describe = (use: { name: unknown; input?: unknown }) =>
    agent.describeAttempt(
      String(use.name),
      (use.input ?? {}) as Record<string, any>,
    );

  if (notOffered) {
    const pendingQuestion = turn.held.find(isQuestionFrame);
    problems.push({
      key: 'not_offered',
      toModel: pendingQuestion
        ? `The ${user} is already being asked something this turn ("${clipText(
            pendingQuestion.data?.prompt,
            120,
          )}"). End with \`${agent.closingTool}\`; ask anything else after they answer.`
        : `\`${endingName}\` is not available at this point — end with \`${agent.closingTool}\`.`,
      toUser: `${name} asked two questions in one turn.`,
    });
  }

  const failedHere = others.filter(
    (use) => results.get(use.id)?.ok === false && !results.get(use.id)?.notRun,
  );
  if (failedHere.length) {
    problems.push({
      key: `failed:${failedHere.map((use) => use.id).join(',')}`,
      toModel:
        `${failedHere.length === 1 ? 'A call' : `${failedHere.length} calls`} in this step ` +
        'failed, and the reply was written without knowing it: ' +
        failedHere
          .map(
            (use) =>
              `${describe(use)} — ${describeToolFailure(results.get(use.id) ?? {})}`,
          )
          .join('; ') +
        '. Repair it or try another way — or, if it cannot be done, say so in the message.',
      toUser: `Written before ${name} saw that ${
        failedHere.length === 1 ? 'a call' : `${failedHere.length} calls`
      } in the same step failed.`,
    });
  }

  const unread = others.filter(
    (use) =>
      agent.isResearch(String(use.name)) && results.get(use.id)?.ok !== false,
  );
  if (unread.length) {
    problems.push({
      key: `unread:${unread.map((use) => use.id).join(',')}`,
      toModel:
        `You ended the turn in the same step as ${unread.length} lookup(s) (` +
        unread.map(describe).join('; ') +
        '), so the reply was written before their results existed. The results are with ' +
        'this message: read them, then end the turn.',
      toUser: `Written before ${name} had read ${unread.length} of its lookups.`,
    });
  }

  // An edit that failed in an earlier step, with no successful edit since.
  const edits = joinCallsToResults(turn.toolCalls, turn.toolResults).filter(
    (call) => agent.isEdit(call.name) && call.result && !call.result.notRun,
  );
  const lastFailure = edits
    .map((call) => call.result?.ok === false)
    .lastIndexOf(true);
  const lastSuccess = edits
    .map((call) => call.result?.ok !== false)
    .lastIndexOf(true);
  const failedEditHere = failedHere.some((use) =>
    agent.isEdit(String(use.name)),
  );
  if (lastFailure > lastSuccess && !failedEditHere) {
    const call = edits[lastFailure];
    problems.push({
      key: `unrepaired:${lastFailure}`,
      toModel:
        `Your last edit failed and nothing since has repaired it: ${agent.describeAttempt(
          call.name,
          call.input,
        )} — ${describeToolFailure(call.result ?? {})}. Repair it, or say in the message ` +
        'that it did not land.',
      toUser: 'An edit failed and nothing repaired it.',
    });
  }

  const moved = agent.stateMoved();
  if (agent.claimsChange(message) && !moved) {
    problems.push({
      key: 'claims_change',
      toModel:
        'Your message says something changed, but nothing did this turn. Make the change ' +
        'first — or, if you have not decided to make it, do not say you did.',
      toUser: `${name} said something changed, but nothing did this turn.`,
    });
  }

  if (agent.extraProblems) {
    problems.push(
      ...(await agent.extraProblems({ name: endingName, input, message })),
    );
  }

  const field = agent.unchangedField;
  if (
    field &&
    agent.userWordsToApply &&
    !moved &&
    !String(input[field] ?? '').trim()
  ) {
    problems.push({
      key: 'unapplied_message',
      toModel:
        `The ${user}'s message ("${clipText(agent.userWordsToApply, 160)}") has not ` +
        'changed anything. Record what it settles before you end the turn — or, if it ' +
        `changes nothing, say why in ${field}.`,
      toUser: `Your message hasn't changed anything, and ${name} didn't say why.`,
    });
  }

  if (endingName === agent.closingTool && !message) {
    problems.push({
      key: 'empty_message',
      toModel: `${agent.closingTool} needs a message — it is the only thing the ${user} sees.`,
      toUser: `${name} ended the turn without a message.`,
    });
  }
  if (endingName === agent.askingTool && !String(input.prompt ?? '').trim()) {
    problems.push({
      key: 'empty_prompt',
      toModel: `${agent.askingTool} needs a prompt — the question itself.`,
      toUser: `${name} asked a question with no text.`,
    });
  }
  return problems;
}

/**
 * Show the reply: its message as one `token` frame (the stream contract every
 * chat already renders), then any card a tool held back, then the question
 * card if the reply asked one. `ending` is null for the prose fallback, which
 * asks nothing.
 */
async function* deliverReply(
  agent: ValidatedTurnAgent,
  turn: ValidatedTurnState,
  ending: Extract<AgentContentBlock, { type: 'tool_use' }> | null,
  message: string,
  warnings: string[],
): AsyncGenerator<AgentTurnFrame> {
  const questionFrames: AgentTurnFrame[] = [];
  if (ending) {
    const name = String(ending.name);
    const input = (ending.input ?? {}) as Record<string, any>;
    const outcome = await executeTool(agent, name, input);
    for (const frame of outcome.events ?? []) {
      agent.onToolFrame?.(frame);
      if (isQuestionFrame(frame)) questionFrames.push(frame);
    }
    turn.toolCalls.push({ id: ending.id, name, input });
    turn.toolResults.push({
      toolUseId: ending.id,
      name,
      result: { ...outcome.modelResult, delivered: true },
    });
    const unchanged = agent.unchangedField
      ? String(input[agent.unchangedField] ?? '').trim()
      : '';
    turn.unchangedBecause = unchanged || null;
  }

  // A reply that was the pass's own prose, not a field of the call, is the
  // reply now rather than a working note.
  const notes = turn.workingNotes;
  if (message && notes[notes.length - 1] === message) notes.pop();

  turn.reply = message || null;
  turn.warnings.push(...warnings);
  turn.stopReason = 'end_turn';
  turn.delivered = true;
  if (message) yield { event: 'token', data: { delta: message } };
  yield* flushHeldFrames(turn);
  for (const frame of questionFrames) {
    turn.questions.push(frame.data);
    yield frame;
  }
  await agent.checkpoint(false);
}
