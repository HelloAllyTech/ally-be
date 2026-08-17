import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import {
  LANGUAGE_TONE_GUIDELINES,
  LANGUAGE_NAME_MAP,
  CODE_MIXED_LANGUAGE_NAME_MAP,
  CODE_MIXING_PRESERVE_WORDS,
} from '../constants/translation.constants';
import { LanguageConfig } from '../type/openai-translation.type';

export type TranslationProgressEvent =
  | {
      kind: 'language_started';
      language: string;
      completed: number;
      total: number;
    }
  | {
      kind: 'language_completed';
      language: string;
      completed: number;
      total: number;
    }
  | {
      kind: 'language_failed';
      language: string;
      completed: number;
      total: number;
      error: string;
    };

export type TranslationProgressCallback = (
  event: TranslationProgressEvent,
) => void;

/** One string to translate, identified by a caller-owned key. */
export interface KeyedTranslationEntry {
  /** The caller's identifier. Never shown to the model. */
  key: string;
  text: string;
  /**
   * What the string is for, e.g. `HTML`, `SHORT_ANSWER`, `BLANK_TEMPLATE`.
   * Drives both the model's per-field instructions and post-hoc validation.
   */
  kind?: string;
  /** Background handed to the model but never translated or echoed. */
  context?: string;
}

export interface KeyedTranslationOptions {
  /** Compiled per-language glossary/style card injected into the prompt. */
  glossary?: string;
  /** DB prompt code to use instead of the course-content default. */
  promptCode?: string;
  batchSize?: number;
  maxCharsPerBatch?: number;
  onBatch?: (translated: number, total: number) => void;
}
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import {
  DEFAULT_OPENAI_TRANSLATION_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_OPENAI_TRANSLATION_USER_PROMPT_TEMPLATE,
  DEFAULT_OPENAI_BEHAVIOR_INSTRUCTION_TRANSLATION_PROMPT_TEMPLATE,
  DEFAULT_OPENAI_SESSION_EVENT_TRANSLATION_PROMPT_TEMPLATE,
  DEFAULT_OPENAI_TEXT_TRANSLATION_PROMPT_TEMPLATE,
  DEFAULT_OPENAI_TOOLTIP_TRANSLATION_PROMPT_TEMPLATE,
  DEFAULT_OPENAI_TRACK_CONTENT_TRANSLATION_PROMPT_TEMPLATE,
  OPENAI_TRACK_CONTENT_TRANSLATION_PROMPT_CODE,
} from 'src/common/constants/openai-translations.constants';
import { toPromptCode } from 'src/prompt/util/prompt-code.util';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';

@Injectable()
export class OpenAITranslationsService {
  private readonly logger = LoggerService.getInstance(
    OpenAITranslationsService.name,
  );

  private readonly client: OpenAI;
  private readonly model: string;

  constructor(
    private readonly configService: AppConfigService,
    private readonly promptSharedService: PromptSharedService,
    private readonly llmUsage: LlmUsageService,
  ) {
    this.client = new OpenAI({ apiKey: this.configService.openai.apiKey });
    this.model = this.configService.openai.translationModel;
  }

  // Prompt codes for dynamic templates (from openai_translation/*.txt)
  private readonly SYSTEM_PROMPT_CODE = toPromptCode(
    'openai_translation',
    'code_mixed_system',
  );
  private readonly USER_PROMPT_CODE = toPromptCode(
    'openai_translation',
    'speech_reexpression_user',
  );
  private readonly BEHAVIOR_INSTRUCTION_PROMPT_CODE = toPromptCode(
    'openai_translation',
    'learn_behavior_instruction',
  );
  private readonly SESSION_EVENT_PROMPT_CODE = toPromptCode(
    'openai_translation',
    'session_event',
  );
  private readonly TEXT_TRANSLATION_PROMPT_CODE = toPromptCode(
    'openai_translation',
    'general_text_translation',
  );
  private readonly TOOLTIP_TRANSLATION_PROMPT_CODE = toPromptCode(
    'openai_translation',
    'tooltip_translation',
  );

  private renderTemplate(
    template: string,
    variables: Record<string, string>,
  ): string {
    // Support both {{var}} (legacy) and <var> (unified format)
    return template
      .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => variables[key] ?? '')
      .replace(/<(\w+)>/g, (match, key) =>
        key in variables ? String(variables[key] ?? '') : match,
      );
  }

  /* ------------------------------------------------------------------
   * Build system prompt for natural code-mixed language generation
   * ------------------------------------------------------------------ */
  private async buildSystemPrompt(
    targetLanguageCode: string,
    scenarioContext?: any,
    overrideTemplate?: string,
  ): Promise<string> {
    const normalizedCode = this.resolveBaseLanguageCode(targetLanguageCode);
    const languageName =
      LANGUAGE_NAME_MAP[normalizedCode] ?? targetLanguageCode;
    const preserveWords = CODE_MIXING_PRESERVE_WORDS[normalizedCode] || [];
    const toneGuidance = LANGUAGE_TONE_GUIDELINES[normalizedCode] || '';

    // Build comprehensive scenario context if provided
    let fullContext = '';
    if (scenarioContext && Object.keys(scenarioContext).length > 0) {
      const contextParts: string[] = [];

      const addSection = (emoji: string, label: string, value?: string) => {
        if (value) contextParts.push(`${emoji} ${label}:\n${value}`);
      };

      // Character & scenario details
      addSection('📛', 'CHARACTER', scenarioContext.title);
      addSection('👤', 'PERSONALITY', scenarioContext.personality);
      addSection('💭', 'EMOTIONAL TONE', scenarioContext.tone);
      addSection('🌍', 'SITUATION CONTEXT', scenarioContext.context);
      addSection(
        '🎯',
        'TRAINING FOCUS (Counselor should address)',
        scenarioContext.description,
      );

      if (scenarioContext.openingStatements?.length > 0) {
        contextParts.push(
          `💬 TYPICAL OPENING STATEMENTS:\n${scenarioContext.openingStatements.join('\n')}`,
        );
      }

      const demographics = [
        scenarioContext.age && `Age: ${scenarioContext.age}`,
        scenarioContext.gender && `Gender: ${scenarioContext.gender}`,
        scenarioContext.genderIdentity &&
          `Gender Identity: ${scenarioContext.genderIdentity}`,
        scenarioContext.sexualOrientation &&
          `Sexual Orientation: ${scenarioContext.sexualOrientation}`,
        scenarioContext.profession &&
          `Profession: ${scenarioContext.profession}`,
      ].filter(Boolean);

      if (demographics.length > 0) {
        contextParts.push(`👥 DEMOGRAPHICS:\n${demographics.join('\n')}`);
      }

      if (contextParts.length > 0) {
        fullContext = `

════════════════════════════════════════════════════════════
📋 COMPLETE SCENARIO CONTEXT
════════════════════════════════════════════════════════════
${contextParts.join('\n')}

════════════════════════════════════════════════════════════

SPEECH RE-EXPRESSION GOAL:
Re-express the message as if THIS CHARACTER is speaking OUT LOUD to a counselor.

IMPORTANT:
- Do NOT translate word-for-word
- Capture how this character would ACTUALLY talk
- Use their personality, emotional tone (${scenarioContext.tone || 'natural'}), and situation
- Prioritize natural spoken ${languageName} over correctness or formality
`;
      }
    }

    const dbTemplate =
      overrideTemplate ??
      (await this.promptSharedService.getPromptByCode(this.SYSTEM_PROMPT_CODE));

    if (dbTemplate) {
      const preserveWordsString =
        preserveWords.length > 0
          ? preserveWords.join(', ')
          : 'technical terms, app names, proper nouns';

      const filled = this.renderTemplate(dbTemplate, {
        languageName,
        fullContext,
        toneGuidance,
        preserveWords: preserveWordsString,
      });
      return filled;
    }

    // Fallback to static prompt if DB template not found — use constants
    const preserveWordsString =
      preserveWords.length > 0
        ? preserveWords.join(', ')
        : 'technical terms, app names, proper nouns';

    return this.renderTemplate(
      DEFAULT_OPENAI_TRANSLATION_SYSTEM_PROMPT_TEMPLATE,
      {
        languageName,
        fullContext,
        toneGuidance,
        preserveWords: preserveWordsString,
      },
    );
  }

  /* ------------------------------------------------------------------
   * Build user prompt for JSON speech re-expression
   * ------------------------------------------------------------------ */
  private async buildUserPrompt(
    sourceObject: any,
    targetLanguageCode: string,
    overrideTemplate?: string,
  ): Promise<string> {
    const normalizedCode = this.resolveBaseLanguageCode(targetLanguageCode);
    const languageName =
      LANGUAGE_NAME_MAP[normalizedCode] ?? targetLanguageCode;

    const dbTemplate =
      overrideTemplate ??
      (await this.promptSharedService.getPromptByCode(this.USER_PROMPT_CODE));

    const inputJson = JSON.stringify(sourceObject, null, 2);

    if (dbTemplate) {
      const filled = this.renderTemplate(dbTemplate, {
        languageName,
        inputJson,
      });
      return filled;
    }

    // Fallback to static prompt if DB template not found — use constants
    return this.renderTemplate(
      DEFAULT_OPENAI_TRANSLATION_USER_PROMPT_TEMPLATE,
      {
        languageName,
        inputJson,
      },
    );
  }

  /* ------------------------------------------------------------------
   * Resolve base language code from full language code
   * ------------------------------------------------------------------ */
  private resolveBaseLanguageCode(targetLanguageCode: string): string {
    return targetLanguageCode.toLowerCase().split('-')[0];
  }

  /* ------------------------------------------------------------------
   * Get temperature for language
   * ------------------------------------------------------------------ */
  private getTemperatureForLanguage(targetLanguageCode: string): number {
    const baseCode = this.resolveBaseLanguageCode(targetLanguageCode);

    /**
     * Temperature philosophy:
     * - 0.58–0.62 → grounded, natural, conversational
     * - 0.63–0.66 → more expressive, slang-friendly
     * - >0.68     → risk of English drift / style loss (avoid)
     *
     * NOTE:
     * Script dominance is enforced by SYSTEM PROMPT, not temperature.
     */

    const temperatureMap: Record<string, number> = {
      hi: 0.62, // Hindi – conversational Hinglish sweet spot
      pa: 0.64, // Punjabi – naturally expressive, needs more freedom
      ta: 0.63, // Tamil – needs flow to avoid stiffness
      ml: 0.64, // Malayalam – expressive spoken patterns
      te: 0.61, // Telugu – balanced
      kn: 0.61, // Kannada – balanced
      mr: 0.6, // Marathi – can get formal if too high
      bn: 0.6, // Bengali – formal drift risk
      gu: 0.6, // Gujarati – stable
      or: 0.61, // Odia – slight flexibility
    };

    return temperatureMap[baseCode] ?? 0.61;
  }

  /**
   * Rejects translation output that leaked raw HTML entities (a sign the model
   * HTML-escaped angle brackets/quotes instead of leaving text as plain characters)
   * or dropped a `<placeholder>` token that was present in the source text.
   */
  private isTranslationOutputValid(
    sourceJson: string,
    translatedJson: string,
  ): boolean {
    if (/&lt;|&gt;|&amp;|&#\d+;/.test(translatedJson)) {
      return false;
    }

    const sourcePlaceholders = sourceJson.match(/<[^>\s]+>/g) ?? [];
    return sourcePlaceholders.every((token) => translatedJson.includes(token));
  }

  /* ------------------------------------------------------------------
   * Fetch translations from OpenAI API
   * ------------------------------------------------------------------ */
  private async fetchTranslations(
    jsonStrings: string[],
    targetLanguageCode: string,
    systemPrompt: string,
    userPrompt: string,
    task: LlmTask = LlmTask.TRANSLATE_SCENARIO,
  ): Promise<string[]> {
    const temperature = this.getTemperatureForLanguage(targetLanguageCode);

    try {
      const messages = [
        {
          role: 'system',
          content: systemPrompt,
        },
      ];

      if (userPrompt && userPrompt.trim() !== '') {
        messages.push({
          role: 'user',
          content: userPrompt,
        });
      }
      const response = await this.client.chat.completions.create({
        model: this.model,
        temperature,
        response_format: { type: 'json_object' },
        messages: messages as unknown as ChatCompletionMessageParam[],
      });

      this.recordUsage(response.usage, task, { language: targetLanguageCode });

      const content = response.choices?.[0]?.message?.content ?? '';

      if (!content || content.trim() === '') {
        this.logger.warn(
          `[OpenAITranslationsService] Empty response from OpenAI for ${targetLanguageCode}, returning original`,
        );
        return jsonStrings; // Return original as fallback
      }

      try {
        // Parse the response (should be valid JSON)
        JSON.parse(content);
      } catch {
        this.logger.warn(
          `[OpenAITranslationsService] Failed to parse JSON response for ${targetLanguageCode}`,
        );
        // Return original as fallback
        return jsonStrings;
      }

      if (!this.isTranslationOutputValid(jsonStrings[0] ?? '', content)) {
        this.logger.warn(
          `[OpenAITranslationsService] Translation output for ${targetLanguageCode} failed validation (leaked HTML entities or dropped a placeholder), returning original`,
        );
        return jsonStrings;
      }

      return [content];
    } catch (error) {
      this.logger.error(
        `[OpenAITranslationsService] Critical error in fetchTranslations for ${targetLanguageCode}`,
        error as any,
      );
      // Return original as ultimate fallback
      return jsonStrings;
    }
  }

  /* ------------------------------------------------------------------
   * PUBLIC API
   * Translate any object's string fields into multiple languages
   * ------------------------------------------------------------------ */
  async translateScenarioData(
    sourceObject: Record<string, any>,
    targetLanguages: string[],
    translationConsiderableData: any,
    onProgress?: TranslationProgressCallback,
  ): Promise<Record<string, any>> {
    if (!targetLanguages || targetLanguages.length === 0) {
      return {};
    }

    const translatedResult: Record<string, any> = {};
    const total = targetLanguages.length;

    // Loop through each language and translate
    // Fetch templates once to avoid repeated DB calls
    const systemTemplate = await this.promptSharedService.getPromptByCode(
      this.SYSTEM_PROMPT_CODE,
    );

    const userTemplate = await this.promptSharedService.getPromptByCode(
      this.USER_PROMPT_CODE,
    );

    for (let i = 0; i < targetLanguages.length; i++) {
      const language = targetLanguages[i];
      try {
        onProgress?.({
          kind: 'language_started',
          language,
          completed: i,
          total,
        });

        const systemPrompt = await this.buildSystemPrompt(
          language,
          translationConsiderableData,
          systemTemplate ?? undefined,
        );

        const userPrompt = await this.buildUserPrompt(
          sourceObject,
          language,
          userTemplate ?? undefined,
        );

        const translations = await this.fetchTranslations(
          [JSON.stringify(sourceObject)],
          language,
          systemPrompt,
          userPrompt,
        );

        // Parse the translated JSON string back to object
        translatedResult[language] = JSON.parse(
          translations[0] || JSON.stringify(sourceObject),
        );

        onProgress?.({
          kind: 'language_completed',
          language,
          completed: i + 1,
          total,
        });
      } catch (err) {
        this.logger.error(
          `Translation failed for language ${language}`,
          err as any,
        );
        // Return original object as fallback
        translatedResult[language] = JSON.parse(JSON.stringify(sourceObject));

        onProgress?.({
          kind: 'language_failed',
          language,
          completed: i + 1,
          total,
          error: (err as Error)?.message ?? 'Unknown error',
        });
      }
    }

    return translatedResult;
  }

  /* ------------------------------------------------------------------
   * Check if OpenAI API is properly configured
   * ------------------------------------------------------------------ */
  isConfigured(): boolean {
    return !!this.configService.openai.apiKey && !!this.model;
  }

  /* ------------------------------------------------------------------
   * Get language configuration for a given language code
   * ------------------------------------------------------------------ */
  getLanguageConfig(languageCode: string): LanguageConfig | null {
    const normalized = this.resolveBaseLanguageCode(languageCode);

    if (!LANGUAGE_NAME_MAP[normalized]) {
      return null;
    }

    return {
      code: normalized,
      nativeName: LANGUAGE_NAME_MAP[normalized],
      codeMixedName: CODE_MIXED_LANGUAGE_NAME_MAP[normalized] || '',
      toneGuideline: LANGUAGE_TONE_GUIDELINES[normalized] || '',
      commonPreserveWords: CODE_MIXING_PRESERVE_WORDS[normalized] || [],
    };
  }

  private getFallbackPromptTemplate(promptCode: string): string | undefined {
    const fallbackPromptMap: Record<string, string> = {
      [this.BEHAVIOR_INSTRUCTION_PROMPT_CODE]:
        DEFAULT_OPENAI_BEHAVIOR_INSTRUCTION_TRANSLATION_PROMPT_TEMPLATE,
      [this.SESSION_EVENT_PROMPT_CODE]:
        DEFAULT_OPENAI_SESSION_EVENT_TRANSLATION_PROMPT_TEMPLATE,
      [this.TEXT_TRANSLATION_PROMPT_CODE]:
        DEFAULT_OPENAI_TEXT_TRANSLATION_PROMPT_TEMPLATE,
      [this.TOOLTIP_TRANSLATION_PROMPT_CODE]:
        DEFAULT_OPENAI_TOOLTIP_TRANSLATION_PROMPT_TEMPLATE,
    };
    return fallbackPromptMap[promptCode];
  }

  /* ------------------------------------------------------------------
   * Fetch plain-text completion (no JSON parsing)
   * ------------------------------------------------------------------ */
  private async fetchTextCompletion(
    userPrompt: string,
    targetLanguageCode: string,
  ): Promise<string> {
    try {
      const messages: ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content:
            'You are a translator. Output only the translated text, nothing else.',
        },
        { role: 'user', content: userPrompt },
      ];
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
      });
      this.recordUsage(response.usage, LlmTask.TRANSLATE_TEXT, {
        language: targetLanguageCode,
      });
      return (response.choices?.[0]?.message?.content ?? '').trim();
    } catch (error) {
      this.logger.error(
        `[OpenAITranslationsService] fetchTextCompletion failed for ${targetLanguageCode}`,
        error as any,
      );
      return '';
    }
  }

  /* ------------------------------------------------------------------
   * PUBLIC API
   * Translate a single string to the target language
   * ------------------------------------------------------------------ */
  async translateText(
    text: string,
    targetLanguageCode: string,
  ): Promise<string> {
    if (!text || !text.trim()) {
      return text;
    }
    const normalizedCode = this.resolveBaseLanguageCode(targetLanguageCode);
    const languageName =
      LANGUAGE_NAME_MAP[normalizedCode] ?? targetLanguageCode;

    const dbTemplate = await this.promptSharedService.getPromptByCode(
      this.TEXT_TRANSLATION_PROMPT_CODE,
    );
    const fallbackTemplate = this.getFallbackPromptTemplate(
      this.TEXT_TRANSLATION_PROMPT_CODE,
    );
    const promptTemplate = dbTemplate ?? fallbackTemplate;

    if (!promptTemplate) {
      this.logger.warn(
        `[OpenAITranslationsService] Missing prompt for text translation, returning original`,
      );
      return text;
    }

    const filledPrompt = this.renderTemplate(promptTemplate, {
      languageName,
      text: text.trim(),
    });

    const result = await this.fetchTextCompletion(
      filledPrompt,
      targetLanguageCode,
    );

    if (!result) {
      this.logger.warn(
        `[OpenAITranslationsService] Empty translation for ${targetLanguageCode}, returning original`,
      );
      return text;
    }
    return result;
  }

  async translateObjectToLanguages(
    sourceObject: Record<string, any>,
    targetLanguages: string[],
    promptCode: string,
  ) {
    if (!targetLanguages || targetLanguages.length === 0) {
      return {};
    }

    const translatedResult: Record<string, any> = {};

    const promptFromDb =
      await this.promptSharedService.getPromptByCode(promptCode);

    const fallbackPrompt = this.getFallbackPromptTemplate(promptCode);

    const promptTemplate = promptFromDb ?? fallbackPrompt;

    if (!promptTemplate) {
      this.logger.warn(
        `[OpenAITranslationsService] Missing prompt for code ${promptCode}, translations may be suboptimal`,
      );

      return {};
    }

    for (const language of targetLanguages) {
      try {
        const normalizedCode = this.resolveBaseLanguageCode(language);
        const languageName =
          LANGUAGE_NAME_MAP[normalizedCode] ?? language.trim();

        const inputJson = JSON.stringify(sourceObject, null, 2);
        const filledPrompt = this.renderTemplate(promptTemplate, {
          languageName,
          inputJson,
        });

        const translations = await this.fetchTranslations(
          [JSON.stringify(sourceObject)],
          language,
          filledPrompt,
          '',
          LlmTask.TRANSLATE_OBJECT,
        );

        // Parse the translated JSON string back to object
        translatedResult[language] = JSON.parse(
          translations[0] || JSON.stringify(sourceObject),
        );
      } catch (err) {
        this.logger.error(
          `Translation failed for language ${language}`,
          err as any,
        );
        // Return original object as fallback
        translatedResult[language] = JSON.parse(JSON.stringify(sourceObject));
      }
    }

    return translatedResult;
  }

  /* ------------------------------------------------------------------
   * Keyed-string translation (course content)
   * ------------------------------------------------------------------ */

  /**
   * Translates a flat set of keyed strings into ONE language.
   *
   * Differs from {@link translateObjectToLanguages} in two ways that matter for
   * assessed content:
   *
   * 1. **It never silently falls back to English.** `translateObjectToLanguages`
   *    returns the untouched source object when the model errors, the response
   *    is unparseable, or validation fails — indistinguishable, to the caller,
   *    from a successful translation. Storing that as "the Hindi version" would
   *    publish English to Hindi learners. Here, a failure throws.
   * 2. **The model never sees the caller's structure.** Keys are aliased to
   *    opaque `f<n>` handles, so no id, answer key or array shape is exposed to
   *    the model, and results can only ever be read back by key.
   *
   * Per-field integrity is checked before returning: `BLANK_TEMPLATE` fields
   * must come back with every placeholder intact, and `HTML` fields with their
   * tag sequence unchanged.
   */
  async translateKeyedStrings(
    entries: KeyedTranslationEntry[],
    targetLanguageCode: string,
    options?: KeyedTranslationOptions,
  ): Promise<Record<string, string>> {
    if (!entries.length) return {};

    const normalizedCode = this.resolveBaseLanguageCode(targetLanguageCode);
    const languageName =
      LANGUAGE_NAME_MAP[normalizedCode] ?? targetLanguageCode.trim();
    const toneGuidance = LANGUAGE_TONE_GUIDELINES[normalizedCode] ?? '';

    const promptCode =
      options?.promptCode ?? OPENAI_TRACK_CONTENT_TRANSLATION_PROMPT_CODE;
    const promptTemplate =
      (await this.promptSharedService.getPromptByCode(promptCode)) ??
      DEFAULT_OPENAI_TRACK_CONTENT_TRANSLATION_PROMPT_TEMPLATE;

    const batches = this.batchKeyedEntries(
      entries,
      options?.batchSize ?? 25,
      options?.maxCharsPerBatch ?? 9000,
    );

    const result: Record<string, string> = {};
    let done = 0;

    for (const batch of batches) {
      const translated = await this.translateKeyedBatch(batch, {
        languageName,
        toneGuidance,
        glossary: options?.glossary,
        promptTemplate,
        targetLanguageCode,
      });
      Object.assign(result, translated);
      done += batch.length;
      options?.onBatch?.(done, entries.length);
    }

    return result;
  }

  /**
   * Splits entries so no single request carries too many fields or too much
   * text. A batch that is too large degrades quality field-by-field long before
   * it hits a token limit — long option lists start coming back paraphrased.
   */
  private batchKeyedEntries(
    entries: KeyedTranslationEntry[],
    maxEntries: number,
    maxChars: number,
  ): KeyedTranslationEntry[][] {
    const batches: KeyedTranslationEntry[][] = [];
    let current: KeyedTranslationEntry[] = [];
    let chars = 0;

    for (const entry of entries) {
      const size = entry.text.length + (entry.context?.length ?? 0);
      // A single oversized field (a long article body) gets its own request
      // rather than being split — splitting HTML mid-document breaks tags.
      if (
        current.length &&
        (current.length >= maxEntries || chars + size > maxChars)
      ) {
        batches.push(current);
        current = [];
        chars = 0;
      }
      current.push(entry);
      chars += size;
    }
    if (current.length) batches.push(current);
    return batches;
  }

  private async translateKeyedBatch(
    batch: KeyedTranslationEntry[],
    context: {
      languageName: string;
      toneGuidance: string;
      glossary?: string;
      promptTemplate: string;
      targetLanguageCode: string;
    },
  ): Promise<Record<string, string>> {
    // Opaque aliases: the model sees `f1`, never `content.questions[q3].prompt`.
    const byAlias = new Map<string, KeyedTranslationEntry>();
    batch.forEach((entry, index) => byAlias.set(`f${index + 1}`, entry));

    let pending = [...byAlias.keys()];
    const collected: Record<string, string> = {};
    let lastError = '';

    // One retry, narrowed to whatever is still missing or failed validation.
    for (let attempt = 0; attempt < 2 && pending.length; attempt += 1) {
      const payload = pending.map((alias) => {
        const entry = byAlias.get(alias)!;
        return {
          key: alias,
          kind: entry.kind ?? 'PROSE',
          text: entry.text,
          ...(entry.context ? { context: entry.context } : {}),
        };
      });

      const prompt = this.renderTemplate(context.promptTemplate, {
        languageName: context.languageName,
        toneGuidance: context.toneGuidance,
        glossary: context.glossary ?? '',
        blankToken: '{{blankId}}',
        inputJson: JSON.stringify(payload, null, 2),
      });

      let parsed: Record<string, unknown>;
      try {
        parsed = await this.completeJson(prompt, context.targetLanguageCode);
      } catch (error) {
        lastError = (error as Error).message;
        this.logger.warn(
          `[OpenAITranslationsService] Keyed batch attempt ${attempt + 1} failed for ${context.targetLanguageCode}: ${lastError}`,
        );
        continue;
      }

      const stillPending: string[] = [];
      for (const alias of pending) {
        const entry = byAlias.get(alias)!;
        const value = parsed[alias];
        if (typeof value !== 'string' || value.trim() === '') {
          stillPending.push(alias);
          continue;
        }
        const problem = this.validateKeyedTranslation(entry, value);
        if (problem) {
          lastError = `${entry.key}: ${problem}`;
          stillPending.push(alias);
          continue;
        }
        collected[entry.key] = value.trim();
      }
      pending = stillPending;
    }

    if (pending.length) {
      const paths = pending.map((alias) => byAlias.get(alias)!.key);
      throw new Error(
        `Translation to ${context.languageName} failed for ${paths.length} field(s): ` +
          `${paths.slice(0, 5).join(', ')}${paths.length > 5 ? ', …' : ''}` +
          (lastError ? ` (last error: ${lastError})` : ''),
      );
    }

    return collected;
  }

  /** One JSON-mode completion. Throws rather than falling back to the source. */
  private async completeJson(
    systemPrompt: string,
    targetLanguageCode: string,
  ): Promise<Record<string, unknown>> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: this.getTemperatureForLanguage(targetLanguageCode),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
      ] as unknown as ChatCompletionMessageParam[],
    });

    this.recordUsage(response.usage, LlmTask.TRANSLATE_OBJECT, {
      language: targetLanguageCode,
    });

    const content = response.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('empty response from the model');

    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('response was not a JSON object');
    }
    return parsed as Record<string, unknown>;
  }

  /**
   * Structural integrity of one translated field. Returns a reason string when
   * the translation must be rejected, or `undefined` when it is usable.
   */
  private validateKeyedTranslation(
    entry: KeyedTranslationEntry,
    translated: string,
  ): string | undefined {
    if (entry.kind === 'BLANK_TEMPLATE') {
      const tokens = entry.text.match(/\{\{\s*\w+\s*\}\}/g) ?? [];
      const missing = tokens.filter((token) => !translated.includes(token));
      if (missing.length) {
        return `dropped blank placeholder(s) ${missing.join(', ')}`;
      }
    }

    if (entry.kind === 'HTML') {
      const tagNames = (value: string) =>
        (value.match(/<\/?([a-zA-Z][\w-]*)[^>]*>/g) ?? []).map((tag) =>
          tag.replace(/<\/?([a-zA-Z][\w-]*)[^>]*>/, (_, name: string) =>
            name.toLowerCase(),
          ),
        );
      const source = tagNames(entry.text);
      const output = tagNames(translated);
      if (source.join('|') !== output.join('|')) {
        return `HTML tag sequence changed (${source.length} tags in, ${output.length} out)`;
      }
    }

    if (entry.kind === 'SHORT_ANSWER') {
      // A marking key that comes back as a sentence will never match what a
      // learner types into a one-word blank.
      const wordRatio =
        translated.split(/\s+/).length /
        Math.max(entry.text.split(/\s+/).length, 1);
      if (wordRatio > 3 && translated.split(/\s+/).length > 4) {
        return 'marking key came back as a phrase rather than an answer';
      }
    }

    return undefined;
  }

  /** Best-effort token-usage capture from an OpenAI chat-completion response. */
  private recordUsage(
    usage:
      | {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        }
      | undefined,
    task: LlmTask,
    metadata?: Record<string, any>,
  ): void {
    void this.llmUsage.record({
      provider: 'openai',
      model: this.model,
      task,
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
      totalTokens: usage?.total_tokens,
      metadata,
    });
  }
}
