import { toScenarioVoiceGender } from '../voice-gender.util';
import { Gender } from '../../enum/gender.enum';

describe('toScenarioVoiceGender', () => {
  it('passes through the labels the account actually returns', () => {
    // 71 male / 60 female of 153 voices on this account.
    expect(toScenarioVoiceGender('male')).toBe(Gender.MALE);
    expect(toScenarioVoiceGender('female')).toBe(Gender.FEMALE);
  });

  // "River" (SAz9YHcvj6GT2YYXdXww) is 1 of 153 and is labelled `neutral`, which
  // is not a Gender. Handed through raw it autofilled a value the studio's
  // dropdown cannot display and both validators reject, so Save was blocked on
  // a field the admin never touched. Null leaves it unset, which the studio
  // already flags as a non-blocking "no gender set" warning.
  it('returns null for a label outside our enum rather than passing it through', () => {
    expect(toScenarioVoiceGender('neutral')).toBeNull();
  });

  // Deliberately NOT mapped: a gender-neutral voice describes how the audio
  // sounds; non-binary describes a person's identity. Equating them would
  // assert something ElevenLabs never said.
  it('does not quietly reinterpret neutral as non-binary', () => {
    expect(toScenarioVoiceGender('neutral')).not.toBe(Gender.NON_BINARY);
  });

  it('tolerates casing and padding, since the label is free text', () => {
    expect(toScenarioVoiceGender('Female')).toBe(Gender.FEMALE);
    expect(toScenarioVoiceGender('  MALE ')).toBe(Gender.MALE);
    expect(toScenarioVoiceGender('Non-Binary')).toBe(Gender.NON_BINARY);
  });

  it('returns null when the label is absent, as it is on 21 of 153 voices', () => {
    expect(toScenarioVoiceGender(undefined)).toBeNull();
    expect(toScenarioVoiceGender(null)).toBeNull();
    expect(toScenarioVoiceGender('')).toBeNull();
  });
});
