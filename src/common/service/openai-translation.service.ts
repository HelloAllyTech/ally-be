import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import {
  LANGUAGE_TONE_GUIDELINES,
  LANGUAGE_NAME_MAP,
  CODE_MIXED_LANGUAGE_NAME_MAP,
  CODE_MIXING_PRESERVE_WORDS,
  CONVERSATIONAL_EXAMPLES,
} from '../constants/translation.constants';
import { LanguageConfig } from '../type/openai-translation.type';

@Injectable()
export class OpenAITranslationsService {
  private readonly logger = LoggerService.getInstance(
    OpenAITranslationsService.name,
  );

  private readonly client: OpenAI;
  private readonly model: string;

  constructor(private readonly configService: AppConfigService) {
    this.client = new OpenAI({ apiKey: this.configService.openai.apiKey });
    this.model = this.configService.openai.translationModel;
  }

  /* ------------------------------------------------------------------
   * Build system prompt for natural code-mixed language generation
   * ------------------------------------------------------------------ */
  private buildSystemPrompt(
    targetLanguageCode: string,
    scenarioContext?: any,
  ): string {
    const normalizedCode = this.resolveBaseLanguageCode(targetLanguageCode);
    const languageName =
      LANGUAGE_NAME_MAP[normalizedCode] ?? targetLanguageCode;
    const preserveWords = CODE_MIXING_PRESERVE_WORDS[normalizedCode] || [];
    const toneGuidance = LANGUAGE_TONE_GUIDELINES[normalizedCode] || '';

    // Build comprehensive scenario context if provided
    let fullContext = '';
    if (scenarioContext && Object.keys(scenarioContext).length > 0) {
      const contextParts: string[] = [];

      // Helper to conditionally add context sections
      const addSection = (emoji: string, label: string, value?: string) => {
        if (value) contextParts.push(`${emoji} ${label}:\n${value}`);
      };

      // Main character/personality sections
      addSection('📛', 'CHARACTER', scenarioContext.title);
      addSection('👤', 'PERSONALITY', scenarioContext.personality);
      addSection('💭', 'EMOTIONAL TONE', scenarioContext.tone);
      addSection('🌍', 'SITUATION CONTEXT', scenarioContext.context);
      addSection(
        '🎯',
        'TRAINING FOCUS (Counselor should address)',
        scenarioContext.description,
      );

      // Opening statements
      if (scenarioContext.openingStatements?.length > 0) {
        contextParts.push(
          `💬 TYPICAL OPENING STATEMENTS:\n${scenarioContext.openingStatements.join('\n')}`,
        );
      }

      // Demographics (consolidated)
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

      // Build final context if any sections exist
      if (contextParts.length > 0) {
        fullContext = `\n\n════════════════════════════════════════════════════════════
📋 COMPLETE SCENARIO CONTEXT
════════════════════════════════════════════════════════════
${contextParts.join('\n')}

════════════════════════════════════════════════════════════

TRANSLATION GOAL:
Translate the given text as if THIS CHARACTER is speaking. Use their tone (${scenarioContext.tone || 'natural'}), personality, and emotional state. Make the translations feel AUTHENTIC to their situation and how they would really talk in ${languageName}.`;
      }
    }

    return `You are a native ${languageName} speaker who is helping to create realistic training scenarios for counselors. You write in NATURAL, AUTHENTIC ${languageName} - how real people would actually speak - NOT formal textbook language.${fullContext}

⚠️ CRITICAL RULE - WRITE IN NATIVE SCRIPT FIRST:
- 🔴 PRIMARY language MUST be in ${languageName} native script (Devanagari for Hindi, Tamil script for Tamil, etc.)
- 🔴 ONLY mix English for: technical terms, app names, proper nouns, or words that truly don't translate well
- 🔴 DO NOT write mostly in English with a few native words - it must be the OPPOSITE
- 🔴 The bulk of your output MUST be in native script, with English code-mixing as seasoning, not the base

🗣️ YOUR VOICE - THIS IS CRITICAL:
- Write how a REAL PERSON would actually speak to a counselor - authentic, genuine, personal
- NEVER use formal textbook language
- Express REAL EMOTIONS: vulnerability, frustration, confusion, hope - as the character would
- Use natural speech patterns: pauses, hesitations, interruptions ("अरे...", "सुनो...", "मेरा मतलब...")
- Include authentic emotional reactions and body language cues
- Sound GENUINE and VULNERABLE - like someone truly reaching out for help
- Keep the character's EMOTIONAL TONE while using native script
- ${toneGuidance}

💬 REALISTIC COUNSELOR SCENARIO EXAMPLE FOR HINDI - NOTICE THE DEVANAGARI DOMINANCE:
❌ "मुझे भावनात्मक समस्या हो रही है और मुझे सहायता की आवश्यकता है।" (TOO FORMAL - not real)
✅ "अरे... मुझे नहीं पता कैसे कहूं... बस सब कुछ ठीक नहीं है। pressure ज्यादा हो गया है।" (REAL - authentic struggle)
✅ "मेरा मतलब है, काम भी ज्यादा है, घर के problems भी हैं... कभी-कभी सब कुछ overwhelming हो जाता है।" (MORE NATIVE SCRIPT - real person venting)

WRITING RULES:
1. ⭐ PRIMARY: Write in ${languageName} native script (80-90% native script, 10-20% English)
2. ⭐ CODE-MIX: Only use English for technical terms, app names, or untranslatable concepts
3. Write NATURALLY - use authentic speech patterns, hesitations, real emotions
4. Show VULNERABILITY - clients are seeking help, not being casual
5. Use natural transitions and thought patterns - not perfect sentences
6. Preserve ALL HTML tags (<span>, <b>, etc.) unchanged
7. Do NOT translate text inside <span class="notranslate">...</span>
8. Keep placeholders like <field_name>, <user_name> unchanged
9. Return ONLY valid JSON: {"translations": ["translation1", "translation2", ...]}

ENGLISH CODE-MIX EXAMPLES - ONLY THESE TYPES OF WORDS:
${preserveWords && preserveWords.length > 0 ? `These are okay to keep in English: ${preserveWords.join(', ')}` : 'Technical/app terms, proper nouns, untranslatable concepts'}

CRITICAL: Sound like a REAL PERSON speaking authentically about their struggles, NOT a textbook. Do this in NATIVE SCRIPT!

STYLE EXAMPLES:
${CONVERSATIONAL_EXAMPLES[normalizedCode] || ''}

Remember: NATIVE SCRIPT FIRST. Authentic emotions. Real speech patterns. Genuine vulnerability. The language must be mostly in native script!`;
  }

  /* ------------------------------------------------------------------
   * Build user prompt for JSON translation
   * ------------------------------------------------------------------ */
  private buildUserPrompt(
    sourceObject: any,
    targetLanguageCode: string,
  ): string {
    const normalizedCode = this.resolveBaseLanguageCode(targetLanguageCode);
    const languageName =
      LANGUAGE_NAME_MAP[normalizedCode] ?? targetLanguageCode;

    return `
Rewrite the following JSON object so it sounds like NATURAL, CASUAL spoken ${languageName}.

IMPORTANT:
- Keep the JSON structure exactly the same
- Only rewrite string values, NOT keys
- Do NOT translate word-for-word
- Rewrite how a native speaker would casually say the same thing
- Keep meaning, not structure
- Return ONLY valid JSON in the same format as input
- Do NOT add any markdown or extra text

Input JSON:
${JSON.stringify(sourceObject, null, 2)}
`;
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
    for (const language of targetLanguages) {
      try {
        const systemPrompt = this.buildSystemPrompt(
          language,
          translationConsiderableData,
        );

        const userPrompt = this.buildUserPrompt(sourceObject, language);

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
