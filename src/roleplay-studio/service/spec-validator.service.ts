import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { ScenarioVoices } from 'src/learn/entity/scenario-voices.entity';
import {
  SPEC_MAX_STATES,
  SPEC_MIN_STATES,
} from '../constants/roleplay-studio.constants';
import {
  RoleplaySpecDocument,
  SPEC_SCHEMA_VERSION,
  SpecValidationError,
  SpecValidationResult,
} from '../type/roleplay-spec-document.type';

/**
 * Hand-written validator for the Roleplay Studio v2 spec document (no zod —
 * class-validator only guards the API edge; the document itself is validated
 * here so the copilot's update_spec tool can get a structured error list back
 * for self-repair).
 *
 * Two layers:
 *  - structural + referential checks (pure, synchronous) — schema version,
 *    state bounds (3-6), exactly one initial state, no dangling
 *    toStateId/behaviorIds/minStateIds/duplicate ids, enum fields.
 *  - DB-backed checks (async, opt-in via `checkDb`) — voice ids must exist
 *    and be active in scenario_voices (and belong to the right language).
 */
@Injectable()
export class SpecValidatorService {
  constructor(private readonly dataSource: DataSource) {}

  /** Full validation; `checkDb: false` skips the catalog lookups. */
  async validate(
    spec: Partial<RoleplaySpecDocument> | null | undefined,
    options: { checkDb?: boolean } = {},
  ): Promise<SpecValidationResult> {
    const errors = this.validateStructure(spec);
    // Referential DB checks only make sense on a structurally sound document.
    if (options.checkDb !== false && errors.length === 0 && spec) {
      errors.push(...(await this.validateAgainstCatalogs(spec)));
    }
    return { valid: errors.length === 0, errors };
  }

  /** Synchronous structural + referential validation (no DB). */
  validateStructure(
    spec: Partial<RoleplaySpecDocument> | null | undefined,
  ): SpecValidationError[] {
    const errors: SpecValidationError[] = [];
    const err = (path: string, code: string, message: string) =>
      errors.push({ path, code, message });

    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      err('', 'invalid_document', 'Spec must be a JSON object');
      return errors;
    }

    if (spec.specSchemaVersion !== SPEC_SCHEMA_VERSION) {
      err(
        '/specSchemaVersion',
        'unsupported_schema_version',
        `specSchemaVersion must be "${SPEC_SCHEMA_VERSION}"`,
      );
    }
    if (!this.isNonEmptyString(spec.title)) {
      err('/title', 'required', 'title is required');
    }

    // ---- persona ----
    if (!spec.persona || typeof spec.persona !== 'object') {
      err('/persona', 'required', 'persona is required');
    } else {
      if (!this.isNonEmptyString(spec.persona.identityCore)) {
        err('/persona/identityCore', 'required', 'identityCore is required');
      }
      if (!this.isNonEmptyString(spec.persona.scenarioContext)) {
        err(
          '/persona/scenarioContext',
          'required',
          'scenarioContext is required',
        );
      }
      if (!Array.isArray(spec.persona.chunks)) {
        err('/persona/chunks', 'required', 'persona.chunks must be an array');
      } else {
        const chunkIds = new Set<string>();
        spec.persona.chunks.forEach((chunk, i) => {
          const base = `/persona/chunks/${i}`;
          if (!this.isNonEmptyString(chunk?.id)) {
            err(`${base}/id`, 'required', 'chunk id is required');
          } else if (chunkIds.has(chunk.id)) {
            err(
              `${base}/id`,
              'duplicate_id',
              `duplicate chunk id "${chunk.id}"`,
            );
          } else {
            chunkIds.add(chunk.id);
          }
          if (
            !Array.isArray(chunk?.topics) ||
            chunk.topics.some((t) => !this.isNonEmptyString(t))
          ) {
            err(
              `${base}/topics`,
              'invalid_type',
              'chunk topics must be an array of strings',
            );
          }
          if (!this.isNonEmptyString(chunk?.content)) {
            err(`${base}/content`, 'required', 'chunk content is required');
          }
        });
      }
    }

    // ---- stateMachine ----
    const stateIds = new Set<string>();
    const behaviorIds = new Set<string>();

    // Collect rubric behavior ids first — transitions/events reference them.
    if (spec.rubric && Array.isArray(spec.rubric.behaviors)) {
      for (const behavior of spec.rubric.behaviors) {
        if (this.isNonEmptyString(behavior?.id)) {
          behaviorIds.add(behavior.id);
        }
      }
    }

    if (!spec.stateMachine || typeof spec.stateMachine !== 'object') {
      err('/stateMachine', 'required', 'stateMachine is required');
    } else {
      const states = spec.stateMachine.states;
      if (!Array.isArray(states)) {
        err(
          '/stateMachine/states',
          'required',
          'stateMachine.states must be an array',
        );
      } else {
        if (
          states.length < SPEC_MIN_STATES ||
          states.length > SPEC_MAX_STATES
        ) {
          err(
            '/stateMachine/states',
            'state_count_out_of_bounds',
            `stateMachine must have between ${SPEC_MIN_STATES} and ${SPEC_MAX_STATES} states (got ${states.length})`,
          );
        }
        states.forEach((state, i) => {
          const base = `/stateMachine/states/${i}`;
          if (!this.isNonEmptyString(state?.id)) {
            err(`${base}/id`, 'required', 'state id is required');
          } else if (stateIds.has(state.id)) {
            err(
              `${base}/id`,
              'duplicate_id',
              `duplicate state id "${state.id}"`,
            );
          } else {
            stateIds.add(state.id);
          }
          if (!this.isNonEmptyString(state?.name)) {
            err(`${base}/name`, 'required', 'state name is required');
          }
          if (
            state?.prosodyHints !== undefined &&
            (!Array.isArray(state.prosodyHints) ||
              state.prosodyHints.some((h) => !this.isNonEmptyString(h)))
          ) {
            err(
              `${base}/prosodyHints`,
              'invalid_type',
              'prosodyHints must be an array of strings',
            );
          }
        });

        // Second pass once every state id is known: transition targets/guards.
        states.forEach((state, i) => {
          (state?.transitions ?? []).forEach((transition, j) => {
            const base = `/stateMachine/states/${i}/transitions/${j}`;
            if (!this.isNonEmptyString(transition?.id)) {
              err(`${base}/id`, 'required', 'transition id is required');
            }
            if (!this.isNonEmptyString(transition?.toStateId)) {
              err(`${base}/toStateId`, 'required', 'toStateId is required');
            } else if (!stateIds.has(transition.toStateId)) {
              err(
                `${base}/toStateId`,
                'dangling_reference',
                `toStateId "${transition.toStateId}" does not match any state`,
              );
            }
            for (const field of [
              'whenBehaviorsAny',
              'whenBehaviorsAll',
            ] as const) {
              const refs = transition?.[field];
              if (refs === undefined) continue;
              if (!Array.isArray(refs)) {
                err(
                  `${base}/${field}`,
                  'invalid_type',
                  `${field} must be an array of rubric behavior ids`,
                );
                continue;
              }
              refs.forEach((behaviorId, k) => {
                if (!behaviorIds.has(behaviorId)) {
                  err(
                    `${base}/${field}/${k}`,
                    'dangling_reference',
                    `behavior id "${behaviorId}" is not defined in the rubric`,
                  );
                }
              });
            }
            if (
              transition?.minTurnsInState !== undefined &&
              !this.isNonNegativeNumber(transition.minTurnsInState)
            ) {
              err(
                `${base}/minTurnsInState`,
                'invalid_type',
                'minTurnsInState must be a non-negative number',
              );
            }
            if (
              transition?.minCumulativeScore !== undefined &&
              typeof transition.minCumulativeScore !== 'number'
            ) {
              err(
                `${base}/minCumulativeScore`,
                'invalid_type',
                'minCumulativeScore must be a number',
              );
            }
          });
        });
      }

      // Exactly one state must match initialStateId.
      const initialId = spec.stateMachine.initialStateId;
      if (!this.isNonEmptyString(initialId)) {
        err(
          '/stateMachine/initialStateId',
          'required',
          'initialStateId is required',
        );
      } else if (Array.isArray(states)) {
        const matches = states.filter((s) => s?.id === initialId).length;
        if (matches !== 1) {
          err(
            '/stateMachine/initialStateId',
            'invalid_initial_state',
            `initialStateId "${initialId}" must match exactly one state (matched ${matches})`,
          );
        }
      }
    }

    // ---- rubric ----
    if (!spec.rubric || !Array.isArray(spec.rubric.behaviors)) {
      err('/rubric/behaviors', 'required', 'rubric.behaviors must be an array');
    } else {
      const seen = new Set<string>();
      spec.rubric.behaviors.forEach((behavior, i) => {
        const base = `/rubric/behaviors/${i}`;
        if (!this.isNonEmptyString(behavior?.id)) {
          err(`${base}/id`, 'required', 'behavior id is required');
        } else if (seen.has(behavior.id)) {
          err(
            `${base}/id`,
            'duplicate_id',
            `duplicate behavior id "${behavior.id}"`,
          );
        } else {
          seen.add(behavior.id);
        }
        if (!this.isNonEmptyString(behavior?.name)) {
          err(`${base}/name`, 'required', 'behavior name is required');
        }
        if (
          behavior?.polarity !== 'helpful' &&
          behavior?.polarity !== 'unhelpful'
        ) {
          err(
            `${base}/polarity`,
            'invalid_enum',
            `polarity must be 'helpful' or 'unhelpful'`,
          );
        }
        if (
          behavior?.weight !== undefined &&
          typeof behavior.weight !== 'number'
        ) {
          err(`${base}/weight`, 'invalid_type', 'weight must be a number');
        }
      });
    }

    // ---- disclosureLedger ----
    if (
      !spec.disclosureLedger ||
      !Array.isArray(spec.disclosureLedger.secrets)
    ) {
      err(
        '/disclosureLedger/secrets',
        'required',
        'disclosureLedger.secrets must be an array',
      );
    } else {
      const secretIds = new Set<string>();
      spec.disclosureLedger.secrets.forEach((secret, i) => {
        const base = `/disclosureLedger/secrets/${i}`;
        if (!this.isNonEmptyString(secret?.id)) {
          err(`${base}/id`, 'required', 'secret id is required');
        } else if (secretIds.has(secret.id)) {
          err(
            `${base}/id`,
            'duplicate_id',
            `duplicate secret id "${secret.id}"`,
          );
        } else {
          secretIds.add(secret.id);
        }
        if (!this.isNonEmptyString(secret?.topic)) {
          err(`${base}/topic`, 'required', 'secret topic is required');
        }
        if (!this.isNonEmptyString(secret?.content)) {
          err(`${base}/content`, 'required', 'secret content is required');
        }
        (secret?.minStateIds ?? []).forEach((stateId, j) => {
          if (!stateIds.has(stateId)) {
            err(
              `${base}/minStateIds/${j}`,
              'dangling_reference',
              `state id "${stateId}" does not match any state`,
            );
          }
        });
      });
    }

    // ---- engineeredEvents ----
    if (spec.engineeredEvents !== undefined) {
      if (!Array.isArray(spec.engineeredEvents)) {
        err(
          '/engineeredEvents',
          'invalid_type',
          'engineeredEvents must be an array',
        );
      } else {
        const eventIds = new Set<string>();
        spec.engineeredEvents.forEach((event, i) => {
          const base = `/engineeredEvents/${i}`;
          if (!this.isNonEmptyString(event?.id)) {
            err(`${base}/id`, 'required', 'event id is required');
          } else if (eventIds.has(event.id)) {
            err(
              `${base}/id`,
              'duplicate_id',
              `duplicate event id "${event.id}"`,
            );
          } else {
            eventIds.add(event.id);
          }
          if (!this.isNonEmptyString(event?.name)) {
            err(`${base}/name`, 'required', 'event name is required');
          }
          if (
            !['time', 'behavior', 'score'].includes(event?.trigger as string)
          ) {
            err(
              `${base}/trigger`,
              'invalid_enum',
              `trigger must be one of 'time', 'behavior', 'score'`,
            );
          }
          if (
            event?.trigger === 'time' &&
            !this.isNonNegativeNumber(event?.atSeconds)
          ) {
            err(
              `${base}/atSeconds`,
              'required',
              'time-triggered events need a non-negative atSeconds',
            );
          }
          if (event?.trigger === 'behavior') {
            if (
              !Array.isArray(event?.behaviorIds) ||
              event.behaviorIds.length === 0
            ) {
              err(
                `${base}/behaviorIds`,
                'required',
                'behavior-triggered events need behaviorIds',
              );
            }
          }
          if (
            event?.trigger === 'score' &&
            typeof event?.scoreThreshold !== 'number'
          ) {
            err(
              `${base}/scoreThreshold`,
              'required',
              'score-triggered events need a numeric scoreThreshold',
            );
          }
          (event?.behaviorIds ?? []).forEach((behaviorId, j) => {
            if (!behaviorIds.has(behaviorId)) {
              err(
                `${base}/behaviorIds/${j}`,
                'dangling_reference',
                `behavior id "${behaviorId}" is not defined in the rubric`,
              );
            }
          });
        });
      }
    }

    // ---- voice / language ----
    if (
      !spec.voice ||
      typeof spec.voice !== 'object' ||
      !spec.voice.languageVoices ||
      typeof spec.voice.languageVoices !== 'object' ||
      Array.isArray(spec.voice.languageVoices)
    ) {
      err(
        '/voice/languageVoices',
        'required',
        'voice.languageVoices must be a { [languageId]: scenarioVoiceId } map',
      );
    } else if (Object.keys(spec.voice.languageVoices).length === 0) {
      err(
        '/voice/languageVoices',
        'required',
        'voice.languageVoices must map at least one language to a voice',
      );
    }
    if (!spec.language || typeof spec.language !== 'object') {
      err('/language', 'required', 'language is required');
    } else {
      if (typeof spec.language.languageId !== 'number') {
        err(
          '/language/languageId',
          'invalid_type',
          'language.languageId must be a number',
        );
      }
      if (!this.isNonEmptyString(spec.language.languageCode)) {
        err(
          '/language/languageCode',
          'required',
          'language.languageCode is required',
        );
      }
    }

    // ---- misc scalar/opaque blocks ----
    if (
      spec.openingStatement !== undefined &&
      typeof spec.openingStatement !== 'string'
    ) {
      err(
        '/openingStatement',
        'invalid_type',
        'openingStatement must be a string',
      );
    }
    for (const field of ['actorModel', 'directorModel'] as const) {
      const model = spec[field];
      if (model === undefined) continue;
      if (!model || typeof model !== 'object' || Array.isArray(model)) {
        err(`/${field}`, 'invalid_type', `${field} must be an object`);
      } else if (!this.isNonEmptyString(model.provider)) {
        err(`/${field}/provider`, 'required', `${field}.provider is required`);
      }
    }
    // `ui` is client-owned and opaque: the ONLY check is "is an object".
    if (
      spec.ui !== undefined &&
      (typeof spec.ui !== 'object' ||
        spec.ui === null ||
        Array.isArray(spec.ui))
    ) {
      err('/ui', 'invalid_type', 'ui must be an object');
    }

    return errors;
  }

  /**
   * Catalog checks: voices must exist + be active in scenario_voices (and
   * belong to the language they are keyed under).
   */
  private async validateAgainstCatalogs(
    spec: Partial<RoleplaySpecDocument>,
  ): Promise<SpecValidationError[]> {
    const errors: SpecValidationError[] = [];
    const languageVoices = spec.voice?.languageVoices ?? {};
    const voiceIds = [...new Set(Object.values(languageVoices))].filter(
      Boolean,
    );

    if (voiceIds.length > 0) {
      const voices = await this.dataSource
        .getRepository(ScenarioVoices)
        .find({ where: { id: In(voiceIds) } });
      const voicesById = new Map(voices.map((voice) => [voice.id, voice]));
      for (const [languageId, voiceId] of Object.entries(languageVoices)) {
        const path = `/voice/languageVoices/${languageId}`;
        const voice = voicesById.get(voiceId);
        if (!voice) {
          errors.push({
            path,
            code: 'unknown_voice',
            message: `voice "${voiceId}" does not exist in scenario_voices`,
          });
        } else if (!voice.active) {
          errors.push({
            path,
            code: 'inactive_voice',
            message: `voice "${voiceId}" (${voice.name}) is inactive`,
          });
        } else if (String(voice.languageId) !== String(languageId)) {
          errors.push({
            path,
            code: 'voice_language_mismatch',
            message: `voice "${voiceId}" belongs to language ${voice.languageId}, not ${languageId}`,
          });
        }
      }
    }

    return errors;
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private isNonNegativeNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }
}
