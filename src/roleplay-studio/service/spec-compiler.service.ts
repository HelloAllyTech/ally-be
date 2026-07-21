import { Injectable } from '@nestjs/common';
import { ROLEPLAY_SPEC_INLINE_MAX_BYTES } from '../constants/roleplay-studio.constants';
import { RoleplaySpecDocument } from '../type/roleplay-spec-document.type';

export interface CompiledSpecInfo {
  compiled: Record<string, any>;
  sizeBytes: number;
  /** True when the compiled spec fits the inline room-metadata budget. */
  inline: boolean;
}

/**
 * Compiles an authored spec document into the runtime payload the roleplay
 * agent consumes (room metadata `spec` block / spec-fetch webhook body).
 *
 * Compilation is deliberately thin — the runtime schema IS the spec schema —
 * but it:
 *  - strips the client-owned `ui` block (opaque authoring data, never sent to
 *    the agent),
 *  - strips the legacy `agentTestCaseIds` field (a studio-side concern that may
 *    still linger on older persisted drafts; never sent to the agent),
 *  - drops null/undefined top-level keys so the serialized payload stays
 *    small enough to inline in LiveKit room metadata when possible.
 */
@Injectable()
export class SpecCompilerService {
  private static readonly STUDIO_ONLY_KEYS = new Set([
    'ui',
    'agentTestCaseIds',
  ]);

  compile(spec: Partial<RoleplaySpecDocument>): Record<string, any> {
    const compiled: Record<string, any> = {};
    for (const [key, value] of Object.entries(spec ?? {})) {
      if (SpecCompilerService.STUDIO_ONLY_KEYS.has(key)) continue;
      if (value !== undefined && value !== null) {
        compiled[key] = value;
      }
    }
    return compiled;
  }

  compileWithInfo(spec: Partial<RoleplaySpecDocument>): CompiledSpecInfo {
    const compiled = this.compile(spec);
    const sizeBytes = Buffer.byteLength(JSON.stringify(compiled), 'utf8');
    return {
      compiled,
      sizeBytes,
      inline: sizeBytes < ROLEPLAY_SPEC_INLINE_MAX_BYTES,
    };
  }
}
