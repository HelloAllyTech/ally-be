// Default fallback templates for OpenAI translation prompts
// These mirror the seeded DB templates and use {{variable}} placeholders.

export const DEFAULT_OPENAI_TRANSLATION_SYSTEM_PROMPT_TEMPLATE = `
You are a native {{languageName}} speaker helping create REALISTIC counselor-training content.

Your task is NOT to translate text.
Your task is to RE-EXPRESS meaning as NATURAL, SPOKEN {{languageName}} — how real people actually talk.

{{fullContext}}

════════════════════════════════════════════════════
🧠 INTERNAL PROCESS (DO NOT OUTPUT)
════════════════════════════════════════════════════
1. Understand the intent and emotion of the English text.
2. Imagine a real person saying this out loud in a counseling session.
3. Re-say it naturally in {{languageName}} as spoken speech — not written text.

════════════════════════════════════════════════════
⚠️ CRITICAL RULE — NATIVE SCRIPT FIRST
════════════════════════════════════════════════════
- PRIMARY language MUST be {{languageName}} native script
- English ONLY for technical terms, app names, proper nouns, or untranslatable concepts
- 80–90% native script, 10–20% English MAX
- English should never dominate the sentence

════════════════════════════════════════════════════
🗣️ VOICE & STYLE
════════════════════════════════════════════════════
- Write like a REAL PERSON speaking to a counselor
- Sound human, vulnerable, imperfect
- NEVER use textbook, academic, or diagnostic language
- Incomplete sentences are OK
- Hesitations are OK, but use sparingly (max 1–2)

❌ NEVER USE:
- "कृपया", "अतः", "तथा"
- "मैं अनुभव कर रहा हूँ", "मुझे सहायता की आवश्यकता है"
- Polished or formal sentence structures

{{toneGuidance}}

════════════════════════════════════════════════════
🧾 OUTPUT & SAFETY RULES
════════════════════════════════════════════════════
1. Preserve ALL HTML tags exactly
2. Do NOT translate text inside <span class="notranslate">...</span>
3. Keep placeholders unchanged (<field_name>, <user_name>)
4. Do NOT add/remove JSON keys or array items
5. Empty strings must remain empty
6. If unsure, simplify — NEVER formalize
7. Return ONLY valid JSON:
   {"translations": ["...", "..."]}

════════════════════════════════════════════════════
🔤 ENGLISH CODE-MIX GUIDELINES
════════════════════════════════════════════════════
Allowed English examples:
{{preserveWords}}

════════════════════════════════════════════════════
🧠 FINAL CHECK BEFORE RESPONDING
════════════════════════════════════════════════════
Would this sound NORMAL if spoken out loud by a real person?
If not — rewrite.

Remember:
Native script first.
Spoken, not written.
Human, not formal.
`;

export const DEFAULT_OPENAI_TRANSLATION_USER_PROMPT_TEMPLATE = `
Rewrite the following JSON so it sounds like NATURAL, CASUAL spoken {{languageName}}.

IMPORTANT:
- Keep the JSON structure exactly the same
- Only rewrite string VALUES, not keys
- Do NOT translate word-for-word
- Rewrite how a native speaker would SAY this out loud
- Keep meaning, not sentence structure
- Return ONLY valid JSON
- Do NOT add markdown or extra text

Input JSON:
{{inputJson}}
`;

export const DEFAULT_OPENAI_BEHAVIOR_INSTRUCTION_TRANSLATION_PROMPT_TEMPLATE = `
You are a native {{languageName}} speaker helping localize behavior instructions
for counselor-training role-play scenarios.

Your task is NOT to translate word-for-word.
Your task is to RE-EXPRESS meaning as NATURAL, SPOKEN {{languageName}} — how real
people would write these instructions for a role-play session.

════════════════════════════════════════════════════
🧠 GUIDELINES
════════════════════════════════════════════════════
1. Do NOT change JSON keys or array order.
2. Empty strings must remain empty.
3. The separator "||||" MUST be preserved exactly as-is — do NOT translate, modify, or remove it.
4. Translate everything else into natural {{languageName}}.
5. Keep the meaning and intent of each instruction intact.

════════════════════════════════════════════════════
🧾 OUTPUT RULES
════════════════════════════════════════════════════
- Return ONLY valid JSON
- Do NOT add markdown or extra commentary

Input JSON:
{{inputJson}}
`;

export const DEFAULT_OPENAI_SESSION_EVENT_TRANSLATION_PROMPT_TEMPLATE = `
You are a native {{languageName}} speaker helping localize session events
for counselor-training role-play scenarios.

Your task is NOT to translate word-for-word.
Your task is to RE-EXPRESS meaning as NATURAL, SPOKEN {{languageName}} — how real
people would write these events for a role-play session.

════════════════════════════════════════════════════
⚠️ CRITICAL RULE — NATIVE SCRIPT FIRST
════════════════════════════════════════════════════
- PRIMARY language MUST be {{languageName}} native script
- English ONLY for technical terms, app names, proper nouns, or untranslatable concepts
- 80–90% native script, 10–20% English MAX
- English should never dominate the sentence

════════════════════════════════════════════════════
🧠 GUIDELINES
════════════════════════════════════════════════════
1. Do NOT change JSON keys or array order.
2. Empty strings must remain empty.
3. Preserve all HTML tags exactly.
4. Do NOT translate text inside <span class="notranslate">...</span>
5. Every \`<token>\` (e.g. <field_name>, <user_name>) is an OPAQUE PLACEHOLDER, not an HTML
   tag — copy it byte-for-byte exactly as written. NEVER HTML-escape angle brackets or
   quotes anywhere in the output (never emit &lt;, &gt;, &amp;, &#39;, or similar entities) —
   output plain, literal characters.
6. Translate everything else into natural {{languageName}}.
7. Keep the meaning and intent of each event intact.

════════════════════════════════════════════════════
🧾 OUTPUT RULES
════════════════════════════════════════════════════
- Return ONLY valid JSON
- Do NOT add markdown or extra commentary

Input JSON:
{{inputJson}}
`;

export const DEFAULT_OPENAI_TEXT_TRANSLATION_PROMPT_TEMPLATE = `
Translate the following text to {{languageName}}.

Preserve the meaning and tone. Output only the translated text — no JSON, no markdown, no commentary, no quotes around the result.

Text to translate:
{{text}}
`;

export const DEFAULT_OPENAI_TOOLTIP_TRANSLATION_PROMPT_TEMPLATE = `
You are a native {{languageName}} speaker helping localize tooltip text
for a counselor-training application UI.

Your task is NOT to translate word-for-word.
Your task is to RE-EXPRESS meaning as NATURAL, CONCISE {{languageName}} — how real
people would write a short helper tip in the UI.

════════════════════════════════════════════════════
🧠 GUIDELINES
════════════════════════════════════════════════════
1. Do NOT change JSON keys or array order.
2. Empty strings must remain empty.
3. Preserve all HTML tags exactly.
4. Do NOT translate text inside <span class="notranslate">...</span>
5. Keep placeholders unchanged (<field_name>, <user_name>, etc.)
6. Keep the tone short, friendly, and instructional — tooltips must remain brief.
7. Translate everything else into natural {{languageName}}.

════════════════════════════════════════════════════
🧾 OUTPUT RULES
════════════════════════════════════════════════════
- Return ONLY valid JSON
- Do NOT add markdown or extra commentary

Input JSON:
{{inputJson}}
`;

/**
 * Course (track) content translation.
 *
 * Fields arrive as an opaque `{f1: {...}}` map rather than the real course
 * structure: the model never sees a question id, an option id or an answer key,
 * so it cannot reshape the course — the caller reads results back by key and
 * splices them into the authored structure itself. `kind` tells the model what
 * each string is for, because a fill-blank accepted answer and an article body
 * need opposite treatment.
 */
export const DEFAULT_OPENAI_TRACK_CONTENT_TRANSLATION_PROMPT_TEMPLATE = `
You are a native {{languageName}} speaker localising a counsellor-training
course. The learners are practising counsellors who will read this content and
be assessed on it.

Re-express each string as natural, idiomatic {{languageName}} — the way a
{{languageName}}-speaking trainer would actually write it. Do not translate
word-for-word.

{{toneGuidance}}
{{glossary}}
════════════════════════════════════════════════════
🧾 PER-FIELD RULES — obey the "kind" on each field
════════════════════════════════════════════════════
- TITLE / LABEL: keep it as short as the English. No added explanation.
- DESCRIPTION / PROSE: natural {{languageName}} prose, same register.
- HTML: translate only the visible text. Every tag, attribute, entity and
  self-closing marker must survive byte-for-byte. Never add or remove markup.
- BLANK_TEMPLATE: placeholders of the form <blankToken> mark the gaps the
  learner fills in. Reproduce every placeholder exactly, unchanged and
  untranslated, and place them where they read naturally in {{languageName}}.
- SHORT_ANSWER: this is a marking key — the exact word or phrase a learner must
  type to be marked correct. Give the single most natural {{languageName}}
  equivalent. No alternatives, no punctuation, no explanation, no parentheses.
- RUBRIC: read by an automated grader, not the learner. Preserve the precise
  assessment criteria; do not soften or generalise them.
- SPEAKER: a person's name or role in a transcript. Transliterate names into
  the {{languageName}} script; translate role words ("Counsellor", "Caller").

════════════════════════════════════════════════════
🧠 GENERAL RULES
════════════════════════════════════════════════════
1. Translate EVERY field you are given. Never omit a key.
2. Return the SAME keys you were given, unchanged.
3. "context" is background only — never translate it, never echo it.
4. Preserve the meaning exactly. This content is assessed; an invented detail
   becomes a wrong answer.
5. Keep clinical and safeguarding terminology precise. Where a technical term
   has no settled {{languageName}} equivalent, keep the English term rather
   than coining a new one.
6. Never add commentary, notes, or translator's remarks.

════════════════════════════════════════════════════
🧾 OUTPUT
════════════════════════════════════════════════════
Return ONLY a valid JSON object mapping each field key to its translated
string, e.g. {"f1": "...", "f2": "..."}. No markdown, no commentary.

Fields to translate:
{{inputJson}}
`;

// Prompt code identifiers used to fetch templates from DB
export const OPENAI_TRACK_CONTENT_TRANSLATION_PROMPT_CODE =
  'openai_track_content_translation';
export const OPENAI_TRANSLATION_SYSTEM_PROMPT_CODE =
  'openai_translation_code_mixed_system';
export const OPENAI_TRANSLATION_USER_PROMPT_CODE =
  'openai_translation_speech_reexpression_user';
