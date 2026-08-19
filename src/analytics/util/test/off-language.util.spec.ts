import {
  countOffLanguage,
  isEligibleForLanguageCheck,
  isTurnOffLanguage,
  targetScriptRange,
} from '../off-language.util';

/**
 * Every case here is a real turn from production, because the failure mode this
 * guards against is a detector that looks right and flags the wrong thing.
 * Script fidelity already reads 99.3% on this exact corpus.
 */
describe('off-language detection', () => {
  it('flags a Hindi session answered in English', () => {
    expect(
      isTurnOffLanguage(
        'Hi… um, do you have a few minutes? I wanted to talk about something',
        'hi-IN',
      ),
    ).toBe(true);
  });

  it('flags romanised Hindi — the right language, the wrong script', () => {
    // 11 of 16 production hits were this one line, a scenario opening stored in
    // Roman script. Right words, unreadable to a Devanagari check.
    expect(
      isTurnOffLanguage(
        'Tumhare pas time hai kya thoda baat karne ke liye',
        'hi-IN',
      ),
    ).toBe(true);
  });

  it('does NOT flag heavy code-mixing, which is how people actually speak', () => {
    // A proportional threshold would flag this; only a total absence of the
    // target script is unambiguous.
    expect(
      isTurnOffLanguage(
        'हां, ठीक है। मुझे नहीं पता, maybe मैं overthink कर रही हूँ।',
        'hi-IN',
      ),
    ).toBe(false);
    expect(
      isTurnOffLanguage(
        'मैंने noticed किया कि Zeeshan eye contact नहीं करता',
        'hi-IN',
      ),
    ).toBe(false);
  });

  it('does not flag a short turn that made no language choice', () => {
    // "Hmm", "Okay", a name — script-free for reasons that are not a failure.
    expect(isEligibleForLanguageCheck('Hmm… okay', 'hi-IN')).toBe(false);
    expect(isTurnOffLanguage('Zeeshan?', 'hi-IN')).toBe(false);
  });

  it('ignores languages written in Latin, which have no wrong script', () => {
    // Including en would flag every single turn.
    expect(targetScriptRange('en-IN')).toBeNull();
    expect(
      isTurnOffLanguage('I have been feeling overwhelmed lately', 'en-IN'),
    ).toBe(false);
  });

  it('handles each supported script, not just Devanagari', () => {
    expect(
      isTurnOffLanguage('naan innaikku romba kastama irukken', 'ta-IN'),
    ).toBe(true);
    expect(
      isTurnOffLanguage('எனக்கு இன்னைக்கு ரொம்ப கஷ்டமா இருக்கு', 'ta-IN'),
    ).toBe(false);
    expect(
      isTurnOffLanguage('nanage ivattu tumba kashta agtaide', 'kn-IN'),
    ).toBe(true);
    expect(
      isTurnOffLanguage('ഇന്ന് എനിക്ക് വളരെ ബുദ്ധിമുട്ടാണ്', 'ml-IN'),
    ).toBe(false);
  });

  it('counts against ELIGIBLE turns, not all turns', () => {
    const { offLanguage, eligible } = countOffLanguage(
      [
        'Hi, do you have a few minutes to talk about something', // off
        'हां, ठीक है। मुझे नहीं पता, maybe मैं overthink कर रही हूँ।', // fine
        'Hmm', // too short
        'Tumhare pas time hai kya thoda baat karne ke liye', // off
      ],
      'hi-IN',
    );
    // The short turn leaves the denominator entirely rather than counting as
    // clean — otherwise a session of interjections would dilute the rate.
    expect(eligible).toBe(3);
    expect(offLanguage).toBe(2);
  });

  it('treats an unknown language as not checkable rather than guessing', () => {
    expect(isTurnOffLanguage('some text that is long enough', 'xx-YY')).toBe(
      false,
    );
    expect(isTurnOffLanguage('some text that is long enough', null)).toBe(
      false,
    );
  });
});
