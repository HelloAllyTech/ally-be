import { extractGlossarySwaps, parseSwapLine } from '../glossary-swap.util';

const section = (sectionCode: string, content: string) => ({
  sectionCode,
  content,
});

describe('extractGlossarySwaps', () => {
  it('takes canonical one-word rules', () => {
    const swaps = extractGlossarySwaps(
      [
        section(
          'core_style',
          [
            '## Core style',
            '- so: say `அதனால` (avoid: `அதனால்`)',
            '- about: say "பத்தி" (avoid: "பற்றி")',
          ].join('\n'),
        ),
      ],
      'ta-IN',
    );
    expect(swaps).toEqual([
      { avoid: 'அதனால்', say: 'அதனால', sectionCode: 'core_style' },
      { avoid: 'பற்றி', say: 'பத்தி', sectionCode: 'core_style' },
    ]);
  });

  it('leaves multi-word, prose and non-canonical lines prompt-only', () => {
    const swaps = extractGlossarySwaps(
      [
        section(
          'general_vocabulary',
          [
            '- stress: say `டென்ஷன்` (avoid: `மன அழுத்தம்`)',
            '- depression: மன அழுத்தம்',
            'Use the informal `तुम` rather than the formal `आप`.',
            '- so: say `அதனால்.` (avoid: `அதனால`)',
          ].join('\n'),
        ),
      ],
      'ta-IN',
    );
    expect(swaps).toEqual([]);
  });

  it('never swaps address forms, which need the verb to change too', () => {
    const swaps = extractGlossarySwaps(
      [section('pronouns_kinship', '- you: say `तुम` (avoid: `आप`)')],
      'hi-IN',
    );
    expect(swaps).toEqual([]);
  });

  it('drops an avoid-word two rules disagree about', () => {
    const swaps = extractGlossarySwaps(
      [
        section('core_style', '- night: say `ராத்திரி` (avoid: `இரவு`)'),
        section('general_vocabulary', '- night: say `நைட்` (avoid: `இரவு`)'),
        section(
          'general_vocabulary',
          '- evening: say `சாயங்காலம்` (avoid: `மாலை`)',
        ),
      ],
      'ta-IN',
    );
    expect(swaps.map((s) => s.avoid)).toEqual(['மாலை']);
  });

  it('keeps one entry when the same rule appears in two sections', () => {
    const swaps = extractGlossarySwaps(
      [
        section('core_style', '- about: say `பத்தி` (avoid: `பற்றி`)'),
        section('grammar', '- about: say `பத்தி` (avoid: `பற்றி`)'),
      ],
      'ta-IN',
    );
    expect(swaps).toHaveLength(1);
    expect(swaps[0].sectionCode).toBe('core_style');
  });
});

describe('parseSwapLine — the formats live prod glossaries use', () => {
  it.each([
    ['- because: say "ஏன்னா" (not "ஏனென்றால்")', 'ஏன்னா', 'ஏனென்றால்'],
    ['- hospital: ஆஸ்பத்திரி (not மருத்துவமனை)', 'ஆஸ்பத்திரி', 'மருத்துவமனை'],
    ['- but: say `ಆದ್ರೆ` (avoid: `ಆದರೆ`)', 'ಆದ್ರೆ', 'ಆದರೆ'],
    ['- here: say "इथे" (avoid: "येथे")', 'इथे', 'येथे'],
    [
      '- definitely: say "கண்டிப்பா" (avoid: "நிச்சயமாக")',
      'கண்டிப்பா',
      'நிச்சயமாக',
    ],
    [
      '- because: say "कारण" (avoid literary "यास्तव", "हेतूने").',
      'कारण',
      'यास्तव',
    ],
    [
      '- anxiety: say `घबराहट`, `बेचैनी`, `टेंशन` (avoid: `दुश्चिंता`)',
      'घबराहट',
      'दुश्चिंता',
    ],
  ])('%s', (line, say, avoid) => {
    expect(parseSwapLine(line)).toEqual({ say, avoid });
  });

  it('enforces only the first form of a list — the tail can be ambiguous', () => {
    // இரு is also the verb "stay"; only இரண்டு may be swapped.
    expect(
      parseSwapLine('- two: say `ரெண்டு` (avoid: `இரண்டு`, `இரு`)'),
    ).toEqual({
      say: 'ரெண்டு',
      avoid: 'இரண்டு',
    });
  });

  it.each([
    '- worry: say "டென்ஷன்" or "கவலை" (avoid: "பதட்டம்" unless in a clinical context)',
    '- feel: say `लगना`, `फील होना` (avoid: `महसूस करना` unless natural in context)',
    '- talk: say `बात करना` (avoid: `वार्तालाप करना`)',
    'e.g. எப்படி இருக்கீங்க? (not எப்படி இருக்கிறீர்கள்?)',
    '- Use simple verb forms. Say `मैं कर रहा हूँ` (not `मैं कर रहा होऊँगा`).',
    '- depression: டிப்ரஷன், மன அழுத்தம்',
    // Each of these was live in prod and would have been swapped wrongly.
    '- to drink: say `पीना` (e.g., `मैं नहीं पियूँगा`) (avoid using `पाना` for this meaning)',
    '- to ignore (pain, problems): say "கண்டுக்கிறதில்ல" or "பெருசா எடுத்துக்கல" (avoid: "மறுக்கிறேன்")',
    '- Negations: say "नाहीये" or "नाही" (avoid formal "नाहीत".',
    '- to do (gerund): use `ಮಾಡೋದು` (avoid: `ಮಾಡುವುದು`)',
    '- Use colloquial spoken forms, not literary forms. e.g., `ಮಾಡ್ತೀನಿ` (not `ಮಾಡುವೆನು`), `ಬಂದ್ರು` (not `ಬಂದರು`).',
  ])('leaves %s prompt-only', (line) => {
    expect(parseSwapLine(line)).toBeNull();
  });
});

describe('agreement sections', () => {
  it('never swaps from pronoun, kinship or grammar sections', () => {
    const swaps = extractGlossarySwaps(
      [
        section(
          'pronouns_kinship',
          '- he (respect): say `அவங்க` (avoid: `அவர்`)',
        ),
        section('grammar', '- is: say `இருக்கு` (avoid: `இருக்கிறது`)'),
        section('core_style', '- but: say "ஆனா" (not "ஆனால்")'),
      ],
      'ta-IN',
    );
    expect(swaps).toEqual([
      { avoid: 'ஆனால்', say: 'ஆனா', sectionCode: 'core_style' },
    ]);
  });
});
