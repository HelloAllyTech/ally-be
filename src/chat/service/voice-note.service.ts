import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI, { toFile } from 'openai';

import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { SettingsService } from 'src/settings/service/settings.service';
import { toPromptCode } from 'src/prompt/util/prompt-code.util';
import {
  GenerateNoteFromAudioResponseDto,
  VoiceNoteFieldSpec,
  VoiceNoteFieldType,
  VoiceNoteFieldValueDto,
} from '../dto/voice-note.dto';

/** Guard rails so a crafted request can't blow up the prompt/token budget. */
const MAX_FIELDS = 300;
const MAX_LABEL_LEN = 200;
const MAX_HINT_LEN = 500;
const MAX_OPTIONS = 100;
const MAX_TRANSCRIPT_CHARS = 40_000;
const ANTHROPIC_MAX_TOKENS = 4096;

// OpenAI's transcription API infers the container from the filename extension,
// so we derive the extension from the real MIME type rather than trusting the
// client-sent filename (Safari records audio/mp4, Chromium audio/webm).
const MIME_EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
};

const VALID_FIELD_TYPES: ReadonlySet<VoiceNoteFieldType> = new Set([
  'text',
  'multiline',
  'number',
  'select',
  'multiselect',
  'date',
  'boolean',
]);

// Prompt codes for the (superadmin-editable) extraction templates. These map to
// src/prompts/scribe_voice_note/*.txt and surface in Admin > Prompt Management.
const SYSTEM_PROMPT_CODE = toPromptCode(
  'scribe_voice_note',
  'field_extraction_system',
);
const USER_PROMPT_CODE = toPromptCode(
  'scribe_voice_note',
  'field_extraction_user',
);

// Fallbacks used when the prompt hasn't been synced to the DB yet (e.g. a fresh
// deploy before PromptsSyncService has run). These MUST stay in sync with the
// .txt files under src/prompts/scribe_voice_note/ — those files are the editable
// source of truth. The user template's {{transcript}} and {{fields}} runtime
// variables are filled by renderTemplate before the call.
const DEFAULT_SYSTEM_PROMPT = [
  'You extract structured counselling session-note fields from a transcript',
  "of a counsellor's spoken dictation about a session.",
  '',
  'You are given the transcript and a JSON list of target fields. Each field',
  'has an "id", a human-readable "label", a "type", and optionally an',
  '"options" list (allowed choices) and a "hint".',
  '',
  'Return ONLY a single JSON object mapping field id → value, containing an',
  'entry for every field you can confidently fill from the transcript.',
  '',
  'Rules:',
  '- Only include a field when the transcript clearly supports a value. Omit',
  '  any field with no basis — never guess or invent information.',
  '- Be especially careful with clinical fields (risk, self-harm, suicidal',
  '  ideation, trauma, abuse, diagnosis, medication): fill them ONLY when the',
  '  counsellor explicitly states them.',
  '- For "select" and "boolean" fields, the value MUST be exactly one of the',
  '  provided options (verbatim). For "multiselect", return a comma-separated',
  '  list drawn only from the provided options.',
  '- For "multiline" write clear, concise prose; short newline-separated',
  '  points are fine. For "text" keep it short. For "number" return digits',
  '  only. For "date" return the date in a clear form.',
  '- Do not add commentary, markdown, or fields that were not requested.',
  '',
  'Output must be a single JSON object and nothing else.',
].join('\n');

const DEFAULT_USER_PROMPT_TEMPLATE = [
  'TRANSCRIPT:',
  '"""',
  '{{transcript}}',
  '"""',
  '',
  'FIELDS:',
  '{{fields}}',
].join('\n');

/**
 * Turns a counsellor's spoken dictation into structured scribe-note field
 * values. Two steps, both in-process:
 *   1. Speech-to-text via OpenAI (audio buffer in → text out).
 *   2. Field extraction via Anthropic — the transcript plus the caller-supplied
 *      field structure guide the model to emit a JSON object of field → value.
 *
 * The audio buffer is only ever held in memory for the duration of the request
 * and is never written to disk, S3, or the database.
 */
@Injectable()
export class VoiceNoteService {
  private readonly logger = LoggerService.getInstance(VoiceNoteService.name);

  private readonly openai: OpenAI;
  private readonly anthropic: Anthropic;
  private readonly transcriptionModel: string;
  private readonly extractionModel: string;

  constructor(
    private readonly configService: AppConfigService,
    private readonly promptSharedService: PromptSharedService,
    private readonly settingsService: SettingsService,
  ) {
    this.openai = new OpenAI({ apiKey: this.configService.openai.apiKey });
    this.anthropic = new Anthropic({
      apiKey: this.configService.anthropic.apiKey,
    });
    this.transcriptionModel = this.configService.openai.transcriptionModel;
    this.extractionModel = this.configService.anthropic.autofillModel;
  }

  /**
   * Orchestrates transcription + extraction. `fieldsRaw` is the JSON string the
   * multipart form carries (multipart text parts always arrive as strings).
   */
  async generateFromAudio(
    audio: Express.Multer.File | undefined,
    fieldsRaw: string | undefined,
    languageHint?: string,
  ): Promise<GenerateNoteFromAudioResponseDto> {
    // Checked before anything else: both downstream calls (Whisper, then
    // Anthropic) are billable, so a request from an org without the feature
    // must not reach them. Mirrors ChatService.createNote's toggle guard —
    // COUNSELOR_ACCESS alone is not enough.
    const enabled = await this.settingsService.getScribeVoiceNoteEnabled();
    if (!enabled) {
      throw new ForbiddenException(
        'Scribe voice note is not enabled for this organization',
      );
    }

    if (!audio?.buffer?.length) {
      throw new BadRequestException('No audio was provided.');
    }
    const fields = this.parseFields(fieldsRaw);

    const transcript = await this.transcribe(audio, languageHint);
    if (!transcript) {
      // Silent / unintelligible audio. Surfaced to the user as "no speech".
      throw new BadRequestException('NO_SPEECH_DETECTED');
    }

    const values = fields.length
      ? await this.extractFields(transcript, fields)
      : [];

    return { transcript, values };
  }

  // ── Step 1: speech-to-text ────────────────────────────────────────────────

  private async transcribe(
    audio: Express.Multer.File,
    languageHint?: string,
  ): Promise<string> {
    const startedAt = Date.now();
    try {
      const mimetype = (audio.mimetype || 'audio/webm').split(';')[0].trim();
      const ext = MIME_EXTENSIONS[mimetype.toLowerCase()] ?? 'webm';
      const file = await toFile(audio.buffer, `dictation.${ext}`, {
        type: mimetype,
      });

      const result = await this.openai.audio.transcriptions.create({
        file,
        model: this.transcriptionModel,
        // Only pass a language when the client sent a hint; otherwise let the
        // model auto-detect (Ally serves many languages).
        ...(languageHint ? { language: languageHint } : {}),
      });

      const text = (result.text ?? '').trim();
      this.logger.info(
        `[VOICE_NOTE] transcribed model=${this.transcriptionModel} ` +
          `bytes=${audio.size} chars=${text.length} elapsedMs=${Date.now() - startedAt}`,
      );
      return text;
    } catch (error) {
      this.logger.error(
        `[VOICE_NOTE] transcription failed model=${this.transcriptionModel} ` +
          `elapsedMs=${Date.now() - startedAt}: ${(error as any)?.message ?? error}`,
        error as any,
      );
      throw new InternalServerErrorException('Failed to transcribe audio.');
    }
  }

  // ── Step 2: LLM field extraction ──────────────────────────────────────────

  private async extractFields(
    transcript: string,
    fields: VoiceNoteFieldSpec[],
  ): Promise<VoiceNoteFieldValueDto[]> {
    const truncated = transcript.slice(0, MAX_TRANSCRIPT_CHARS);
    const [system, user] = await Promise.all([
      this.buildSystemPrompt(),
      this.buildUserPrompt(truncated, fields),
    ]);

    const startedAt = Date.now();
    let raw: string;
    try {
      const response = await this.anthropic.messages.create({
        model: this.extractionModel,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        system,
        // No assistant-turn prefill: the 4.6+ model family (incl. the default
        // claude-sonnet-4-6) rejects a trailing assistant message with a 400.
        // The system prompt instructs a bare JSON object instead; parseJsonObject
        // strips any markdown fences the model may add.
        messages: [{ role: 'user', content: user }],
      });
      const block = response.content[0];
      raw = block?.type === 'text' ? block.text : '';
    } catch (error) {
      this.logger.error(
        `[VOICE_NOTE] extraction failed model=${this.extractionModel} ` +
          `elapsedMs=${Date.now() - startedAt}: ${(error as any)?.message ?? error}`,
        error as any,
      );
      throw new InternalServerErrorException('Failed to generate note fields.');
    }

    const parsed = this.parseJsonObject(raw);
    const values = this.coerceValues(parsed, fields);
    this.logger.info(
      `[VOICE_NOTE] extracted model=${this.extractionModel} ` +
        `requested=${fields.length} filled=${values.length} elapsedMs=${Date.now() - startedAt}`,
    );
    return values;
  }

  /**
   * The system prompt is a superadmin-editable template
   * (src/prompts/scribe_voice_note/field_extraction_system.txt, editable in
   * Admin > Prompt Management). Falls back to the bundled default if the prompt
   * hasn't been synced to the DB yet.
   */
  private async buildSystemPrompt(): Promise<string> {
    const template =
      await this.promptSharedService.getPromptByCode(SYSTEM_PROMPT_CODE);
    return template?.trim() || DEFAULT_SYSTEM_PROMPT;
  }

  /**
   * The user prompt is a superadmin-editable template
   * (src/prompts/scribe_voice_note/field_extraction_user.txt) carrying two
   * runtime variables — `{{transcript}}` (the dictation transcript) and
   * `{{fields}}` (the JSON array of target fields) — which are substituted here.
   */
  private async buildUserPrompt(
    transcript: string,
    fields: VoiceNoteFieldSpec[],
  ): Promise<string> {
    const fieldsJson = JSON.stringify(
      fields.map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type,
        ...(f.options?.length ? { options: f.options } : {}),
        ...(f.hint ? { hint: f.hint } : {}),
      })),
    );
    const template =
      (
        await this.promptSharedService.getPromptByCode(USER_PROMPT_CODE)
      )?.trim() || DEFAULT_USER_PROMPT_TEMPLATE;
    return this.renderTemplate(template, { transcript, fields: fieldsJson });
  }

  /**
   * Substitute `{{var}}` / `<var>` placeholders in a prompt template with their
   * runtime values in a single left-to-right pass, so injected content (which
   * may itself contain braces or angle brackets, e.g. the fields JSON) is never
   * re-scanned. Unknown `{{placeholders}}` collapse to empty; unknown `<tokens>`
   * (which occur naturally in prose) are left untouched.
   */
  private renderTemplate(
    template: string,
    variables: Record<string, string>,
  ): string {
    return template.replace(
      /\{\{\s*(\w+)\s*\}\}|<(\w+)>/g,
      (match, braceKey?: string, angleKey?: string) => {
        const key = braceKey ?? angleKey;
        if (key && key in variables) return variables[key] ?? '';
        return braceKey !== undefined ? '' : match;
      },
    );
  }

  // ── Parsing / validation helpers ──────────────────────────────────────────

  private parseFields(fieldsRaw: string | undefined): VoiceNoteFieldSpec[] {
    if (!fieldsRaw) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(fieldsRaw);
    } catch {
      throw new BadRequestException('`fields` must be a valid JSON array.');
    }
    if (!Array.isArray(parsed)) {
      throw new BadRequestException('`fields` must be a JSON array.');
    }

    const seen = new Set<string>();
    const specs: VoiceNoteFieldSpec[] = [];
    for (const item of parsed) {
      if (specs.length >= MAX_FIELDS) break;
      if (!item || typeof item !== 'object') continue;
      const { id, label, type, options, hint } = item as Record<
        string,
        unknown
      >;
      if (typeof id !== 'string' || !id) continue;
      if (typeof label !== 'string' || !label) continue;
      if (typeof type !== 'string' || !VALID_FIELD_TYPES.has(type as any)) {
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);

      const spec: VoiceNoteFieldSpec = {
        id,
        label: label.slice(0, MAX_LABEL_LEN),
        type: type as VoiceNoteFieldType,
      };
      if (Array.isArray(options)) {
        const opts = options
          .filter((o): o is string => typeof o === 'string' && o.length > 0)
          .slice(0, MAX_OPTIONS);
        if (opts.length) spec.options = opts;
      }
      if (typeof hint === 'string' && hint) {
        spec.hint = hint.slice(0, MAX_HINT_LEN);
      }
      specs.push(spec);
    }
    return specs;
  }

  private parseJsonObject(raw: string): Record<string, unknown> {
    if (!raw) return {};
    const cleaned = this.stripMarkdownFences(raw).trim();
    try {
      const obj = JSON.parse(cleaned);
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    } catch {
      this.logger.warn(
        '[VOICE_NOTE] could not parse extraction JSON; returning no values',
      );
      return {};
    }
  }

  private stripMarkdownFences(text: string): string {
    return text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  }

  /**
   * Validates the raw LLM output against the requested field specs and coerces
   * each value into a clean, human-readable string. Selects are snapped to a
   * valid option (case-insensitive); unmatched selects are dropped.
   */
  private coerceValues(
    parsed: Record<string, unknown>,
    fields: VoiceNoteFieldSpec[],
  ): VoiceNoteFieldValueDto[] {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const out: VoiceNoteFieldValueDto[] = [];

    for (const [id, rawValue] of Object.entries(parsed)) {
      const spec = byId.get(id);
      if (!spec) continue;
      if (rawValue == null) continue;

      const value = this.coerceValue(spec, rawValue);
      if (value != null && value !== '') {
        out.push({ id, value });
      }
    }
    return out;
  }

  private coerceValue(
    spec: VoiceNoteFieldSpec,
    rawValue: unknown,
  ): string | null {
    switch (spec.type) {
      case 'boolean':
        return this.coerceBoolean(rawValue, spec.options);
      case 'select':
        return this.matchOption(String(rawValue), spec.options);
      case 'multiselect': {
        if (!spec.options?.length) return null;
        const matched = this.toValueList(rawValue)
          .map((p) => this.matchOption(p, spec.options))
          .filter((m): m is string => m != null);
        const unique = [...new Set(matched)];
        // JSON-encode the matched labels so option labels that themselves
        // contain commas survive the round trip (the frontend JSON-parses this
        // back into a label list). A comma-joined string would corrupt them.
        return unique.length ? JSON.stringify(unique) : null;
      }
      case 'number': {
        const digits = String(rawValue)
          .replace(/[^\d.-]/g, '')
          .trim();
        return digits || null;
      }
      default: {
        // text, multiline, date
        const str = Array.isArray(rawValue)
          ? rawValue.map(String).join('\n')
          : String(rawValue);
        return str.trim() || null;
      }
    }
  }

  /** Normalize an LLM multiselect value into a list of candidate labels. */
  private toValueList(rawValue: unknown): string[] {
    if (Array.isArray(rawValue)) return rawValue.map(String);
    const str = String(rawValue).trim();
    if (str.startsWith('[')) {
      try {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        // fall through to comma split
      }
    }
    return str.split(',');
  }

  /**
   * Map a boolean-ish LLM value ("Yes"/"true"/true/1/…) onto the field's
   * Yes/No option labels. The model often emits a JSON boolean or a synonym
   * rather than the exact option string, so match loosely before falling back
   * to an exact option match.
   */
  private coerceBoolean(rawValue: unknown, options?: string[]): string | null {
    const v = String(rawValue).trim().toLowerCase();
    const truthy = ['yes', 'true', 'y', '1'];
    const falsy = ['no', 'false', 'n', '0'];
    if (truthy.includes(v)) {
      return options?.find((o) => truthy.includes(o.toLowerCase())) ?? null;
    }
    if (falsy.includes(v)) {
      return options?.find((o) => falsy.includes(o.toLowerCase())) ?? null;
    }
    return this.matchOption(String(rawValue), options);
  }

  /** Case-insensitive match of a value against allowed option labels. */
  private matchOption(value: string, options?: string[]): string | null {
    if (!options?.length) return null;
    const needle = value.trim().toLowerCase();
    if (!needle) return null;
    const exact = options.find((o) => o.toLowerCase() === needle);
    return exact ?? null;
  }
}
