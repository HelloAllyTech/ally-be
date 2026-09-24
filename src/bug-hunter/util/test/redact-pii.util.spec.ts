import { redactPii } from '../redact-pii.util';

describe('redactPii', () => {
  it('leaves ordinary text unchanged', () => {
    expect(redactPii('Cannot read properties of undefined')).toBe(
      'Cannot read properties of undefined',
    );
  });

  it('redacts an email address', () => {
    expect(redactPii('Failed to notify user@example.com')).toBe(
      'Failed to notify [email]',
    );
  });

  it('redacts a phone number', () => {
    expect(redactPii('Call back on +1 415-555-0100 please')).toBe(
      'Call back on [phone] please',
    );
  });

  it('caps length at 300 characters', () => {
    const long = 'x'.repeat(400);
    expect(redactPii(long).length).toBe(300);
  });
});
