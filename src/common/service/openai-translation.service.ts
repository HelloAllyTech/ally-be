import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import {
  LANGUAGE_TONE_GUIDELINES,
  LANGUAGE_NAME_MAP,
  CODE_MIXED_LANGUAGE_NAME_MAP,
  CODE_MIXING_PRESERVE_WORDS,
} from '../constants/translation.constants';
import { LanguageConfig } from '../type/openai-translation.type';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import {
  DEFAULT_OPENAI_TRANSLATION_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_OPENAI_TRANSLATION_USER_PROMPT_TEMPLATE,
} from 'src/common/constants/openai-translations.constants';
import { PromptCode } from 'src/prompt/enum/prompt-code.enum';

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
  ) {
    this.client = new OpenAI({ apiKey: this.configService.openai.apiKey });
    this.model = this.configService.openai.translationModel;
  }

  // Prompt codes for dynamic templates
  private readonly SYSTEM_PROMPT_CODE =
    PromptCode.OPENAI_TRANSLATION_SYSTEM_PROMPT_CODE;
  private readonly USER_PROMPT_CODE =
    PromptCode.OPENAI_TRANSLATION_USER_PROMPT_CODE;

  private renderTemplate(
    template: string,
    variables: Record<string, string>,
  ): string {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
      return variables[key] ?? '';
    });
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

  /* ------------------------------------------------------------------
   * Fetch translations from OpenAI API
   * ------------------------------------------------------------------ */
  private async fetchTranslations(
    jsonStrings: string[],
    targetLanguageCode: string,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string[]> {
    const temperature = this.getTemperatureForLanguage(targetLanguageCode);

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        temperature,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      });

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
        return [content];
      } catch {
        this.logger.warn(
          `[OpenAITranslationsService] Failed to parse JSON response for ${targetLanguageCode}`,
        );
        // Return original as fallback
        return jsonStrings;
      }
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
  async translateObjectToLanguages(
    sourceObject: any,
    targetLanguages: string[],
    translationConsiderableData: any,
  ): Promise<Record<string, any>> {
    if (!targetLanguages || targetLanguages.length === 0) {
      return {};
    }

    const translatedResult: Record<string, any> = {};

    // Loop through each language and translate
    // Fetch templates once to avoid repeated DB calls
    const systemTemplate = await this.promptSharedService.getPromptByCode(
      this.SYSTEM_PROMPT_CODE,
    );

    const userTemplate = await this.promptSharedService.getPromptByCode(
      this.USER_PROMPT_CODE,
    );

    for (const language of targetLanguages) {
      try {
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
}
