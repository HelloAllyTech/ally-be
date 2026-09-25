import {
  isSwapSafe,
  MiningSession,
  mineBookishLexemes,
} from '../lexeme-mining.util';

/**
 * A corpus where the agent says the literary அதனால் and the counsellors say
 * the colloquial அதனால, across several scenarios — the shape the miner exists
 * to find.
 */
function session(
  id: string,
  scenarioId: number,
  turns: [role: 'agent' | 'learner', text: string][],
): MiningSession {
  return {
    sessionId: id,
    scenarioId,
    turns: turns.map(([role, text]) => ({ role, text })),
  };
}

const literarySessions = (n: number, offset = 0): MiningSession[] =>
  Array.from({ length: n }, (_, i) =>
    session(`s${offset + i}`, offset + i, [
      ['learner', 'சொல்லுங்க என்ன ஆச்சு'],
      ['agent', 'அதனால் தூக்கம் வரல அதனால் கஷ்டமா இருக்கு'],
      ['learner', 'அதனால தான் கேக்குறேன் சொல்லுங்க'],
    ]),
  );

describe('mineBookishLexemes', () => {
  it('surfaces a word the agent says and counsellors do not', () => {
    const { candidates } = mineBookishLexemes(literarySessions(5));
    expect(candidates[0].token).toBe('அதனால்');
    expect(candidates[0].agentCount).toBe(10);
    expect(candidates[0].learnerCount).toBe(0);
  });

  it('does not count a counsellor echoing the agent as population usage', () => {
    // Every counsellor use of தனிமை comes right after the agent said it —
    // exactly the Hindi तनाव pattern (24 of 24 learner uses were echoes).
    const sessions = Array.from({ length: 5 }, (_, i) =>
      session(`e${i}`, i, [
        ['agent', 'எனக்கு ரொம்ப தனிமை உணர்வு இருக்கு'],
        ['learner', 'தனிமை உணர்வு எப்போ இருந்து'],
      ]),
    );
    const { candidates, stats } = mineBookishLexemes(sessions);
    const lonely = candidates.find((c) => c.token === 'தனிமை');
    expect(lonely).toBeDefined();
    expect(lonely!.learnerCount).toBe(0);
    expect(lonely!.learnerEchoCount).toBe(5);
    expect(stats.learnerEchoTokens).toBeGreaterThanOrEqual(10);
  });

  it('counts a counsellor word as their own when they said it first', () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      session(`f${i}`, i, [
        ['learner', 'டென்ஷன் இருக்கா'],
        ['agent', 'ஆமா டென்ஷன் தான்'],
        ['learner', 'டென்ஷன் எப்போ வருது'],
      ]),
    );
    const { learnerLexicon } = mineBookishLexemes(sessions);
    expect(learnerLexicon.find((l) => l.token === 'டென்ஷன்')?.count).toBe(10);
  });

  it('drops scenario-bound words such as persona names', () => {
    // காமாட்சி is said constantly, but only ever inside one scenario.
    const named = Array.from({ length: 6 }, (_, i) =>
      session(`n${i}`, 99, [
        ['agent', 'காமாட்சி காமாட்சி நான் தான் பேசுறேன்'],
        ['learner', 'சொல்லுங்க'],
      ]),
    );
    const { candidates, stats } = mineBookishLexemes([
      ...named,
      ...literarySessions(4),
    ]);
    expect(candidates.map((c) => c.token)).not.toContain('காமாட்சி');
    expect(candidates.map((c) => c.token)).toContain('அதனால்');
    expect(stats.droppedScenarioBound).toBeGreaterThan(0);
  });

  it('skips words the glossary already covers', () => {
    const { candidates, stats } = mineBookishLexemes(literarySessions(5), {
      excludeTokens: ['அதனால்'],
    });
    expect(candidates.map((c) => c.token)).not.toContain('அதனால்');
    expect(stats.droppedAlreadyInGlossary).toBe(1);
  });

  it('keeps literary function words — no stoplist', () => {
    const { candidates } = mineBookishLexemes(literarySessions(5));
    expect(candidates.some((c) => c.token === 'அதனால்')).toBe(true);
  });

  it('attaches agent contexts and builds a de-echoed evidence corpus', () => {
    const { candidates, corpora } = mineBookishLexemes(literarySessions(3), {
      minScenarios: 1,
      minSessions: 1,
    });
    expect(candidates[0].contexts[0]).toContain('அதனால்');
    expect(corpora.agent).toContain('அதனால்');
    expect(corpora.learner).not.toContain('அதனால் ');
    expect(corpora.learner).toContain('அதனால');
  });

  it('returns nothing for an empty corpus', () => {
    const result = mineBookishLexemes([]);
    expect(result.candidates).toEqual([]);
    expect(result.stats.agentLeaningEchoShare).toBeNull();
  });
});

describe('isSwapSafe', () => {
  it('allows single-token swaps of agreement-free classes', () => {
    expect(isSwapSafe('conjunction', 'ಆದರೆ', 'ಆದ್ರೆ')).toBe(true);
    expect(isSwapSafe('lexeme', 'apprehensive', 'nervous')).toBe(true);
  });

  it('refuses address forms, which need the verb to change too', () => {
    expect(isSwapSafe('pronoun_address', 'आप', 'तुम')).toBe(false);
    expect(isSwapSafe('lexeme', 'आप', 'तुम', ['आप', 'तुम'])).toBe(false);
  });

  it('refuses verb forms and multi-word pairs', () => {
    expect(isSwapSafe('verb_form', 'இருக்கிறேன்', 'இருக்கேன்')).toBe(false);
    expect(isSwapSafe('lexeme', 'மன அழுத்தம்', 'டென்ஷன்')).toBe(false);
  });
});
