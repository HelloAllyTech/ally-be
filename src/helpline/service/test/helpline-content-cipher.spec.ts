import {
  HelplineMessageType,
  HelplineRiskOutcome,
  HelplineSenderRole,
} from '../../constants/helpline.constants';
import { HelplineMessageRepository } from '../../repository/helpline-message.repository';
import { toStaffMessageDto } from '../../util/helpline-serializers';
import {
  HELPLINE_CIPHER_PREFIX,
  HELPLINE_UNREADABLE,
  HelplineContentCipher,
  decryptTalker,
} from '../helpline-content-cipher.service';
import { HelplineGuestService } from '../helpline-guest.service';
import { HelplineRiskService } from '../helpline-risk.service';
import { HelplineSessionService } from '../helpline-session.service';
import { HELPLINE_CONSENT_VERSION } from '../../constants/helpline.constants';
import { HELPLINE_DEFAULT_SETTINGS } from '../../constants/helpline-settings.defaults';
import { testCipher } from './helpline-test-cipher';

const CHAT_ID = '11111111-1111-4111-8111-111111111111';

describe('HelplineContentCipher', () => {
  const cipher = testCipher();

  it('round-trips text, including Indic scripts, and never stores it readable', async () => {
    for (const plain of [
      'I have been giving my things away',
      'मैं अब और नहीं जीना चाहता',
      'நான் சோர்வாக இருக்கிறேன்',
      '',
    ]) {
      const stored = await cipher.encrypt(plain);
      expect(stored.startsWith(HELPLINE_CIPHER_PREFIX)).toBe(true);
      if (plain) expect(stored).not.toContain(plain);
      expect(await cipher.decrypt(stored)).toBe(plain);
    }
  });

  it('encrypts the same text differently every time (random IV)', async () => {
    const a = await cipher.encrypt('same');
    const b = await cipher.encrypt('same');
    expect(a).not.toBe(b);
  });

  it('leaves the [erased] marker plaintext in both directions', async () => {
    expect(await cipher.encrypt('[erased]')).toBe('[erased]');
    expect(await cipher.decrypt('[erased]')).toBe('[erased]');
  });

  it('returns legacy plaintext rows as they are, without throwing', async () => {
    expect(await cipher.decrypt('hello from before encryption')).toBe(
      'hello from before encryption',
    );
    // Valid-looking base64 without the prefix is still legacy plaintext.
    expect(await cipher.decrypt('aGVsbG8gd29ybGQ=')).toBe('aGVsbG8gd29ybGQ=');
  });

  it('a talker who types the prefix still gets encrypted', async () => {
    const typed = `${HELPLINE_CIPHER_PREFIX}not really`;
    const stored = await cipher.encrypt(typed);
    expect(stored).not.toBe(typed);
    expect(await cipher.decrypt(stored)).toBe(typed);
  });

  it('a prefixed value that will not decrypt becomes [unreadable] and logs no value', async () => {
    const stored = await cipher.encrypt('the secret');
    const wrongKey = testCipher('cd'.repeat(32));
    const errors: string[] = [];
    const spy = jest
      .spyOn(
        (wrongKey as unknown as { logger: { error: (m: string) => void } })
          .logger,
        'error',
      )
      .mockImplementation((m: string) => {
        errors.push(String(m));
      });
    expect(await wrongKey.decrypt(stored, 'content')).toBe(HELPLINE_UNREADABLE);
    expect(await wrongKey.decrypt(`${HELPLINE_CIPHER_PREFIX}@@@`)).toBe(
      HELPLINE_UNREADABLE,
    );
    expect(errors.join(' ')).not.toContain('the secret');
    expect(errors.join(' ')).not.toContain(stored);
    spy.mockRestore();
  });

  it('refuses to encrypt without a key rather than storing plaintext', async () => {
    const keyless = testCipher(null);
    jest
      .spyOn(
        (keyless as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
    await expect(keyless.encrypt('anything')).rejects.toThrow(/not configured/);
  });

  it('summary fields: { enc } round-trip; legacy objects and {} pass through', async () => {
    const fields = { risk: 'none discussed', feelings: 'tired' };
    const stored = await cipher.encryptFields(fields);
    expect(Object.keys(stored)).toEqual(['enc']);
    expect(JSON.stringify(stored)).not.toContain('tired');
    expect(await cipher.decryptFields(stored)).toEqual(fields);
    expect(await cipher.decryptFields({ risk: 'legacy' })).toEqual({
      risk: 'legacy',
    });
    expect(await cipher.encryptFields({})).toEqual({});
    expect(await cipher.decryptFields({})).toEqual({});
    expect(await cipher.decryptFields(null)).toEqual({});
  });

  it('suggestion text inside metadata is encrypted; ids and keys stay readable', async () => {
    const metadata = {
      suggestions: [{ index: 0, text: 'It sounds heavy', skillKey: 'empathy' }],
      accepted: [0],
    };
    const stored = await cipher.encryptMetadata(metadata);
    const item = (
      stored?.suggestions as { text: string; skillKey: string }[]
    )[0];
    expect(HelplineContentCipher.isEncrypted(item.text)).toBe(true);
    expect(item.skillKey).toBe('empathy');
    expect(stored?.accepted).toEqual([0]);
    expect(await cipher.decryptMetadata(stored)).toEqual(metadata);
  });

  it('decryptTalker restores the display name (and tolerates legacy plaintext)', async () => {
    const encrypted = { displayName: await cipher.encrypt('Asha') } as never;
    expect((await decryptTalker(cipher, encrypted)).displayName).toBe('Asha');
    const legacy = { displayName: 'Anonymous' } as never;
    expect((await decryptTalker(cipher, legacy)).displayName).toBe('Anonymous');
  });
});

describe('HelplineMessageRepository encrypts at the boundary', () => {
  const cipher = testCipher();

  const build = (found: unknown[] = []) => {
    const saved: Record<string, unknown>[] = [];
    const repo = {
      create: (x: unknown) => x,
      save: jest.fn(async (row: Record<string, unknown>) => {
        saved.push({ ...row });
        return { ...row, id: 42, createdAt: new Date() };
      }),
      find: jest.fn().mockResolvedValue(found),
      findOne: jest.fn().mockResolvedValue(found[0] ?? null),
    };
    return {
      repository: new HelplineMessageRepository(repo as never, cipher),
      repo,
      saved,
    };
  };

  it('a DB row goes in encrypted, and the caller gets plaintext back', async () => {
    const { repository, saved } = build();
    const message = await repository.insert({
      tenantId: 't-1',
      chatId: CHAT_ID,
      type: HelplineMessageType.SUGGESTION,
      senderRole: HelplineSenderRole.COPILOT,
      content: 'Suggested replies',
      metadata: {
        suggestions: [{ index: 0, text: 'Tell me more', skillKey: 'verbal' }],
      },
    });
    expect(HelplineContentCipher.isEncrypted(saved[0].content)).toBe(true);
    expect(JSON.stringify(saved[0])).not.toContain('Tell me more');
    expect(message.content).toBe('Suggested replies');
    expect((message.metadata?.suggestions as { text: string }[])[0].text).toBe(
      'Tell me more',
    );
  });

  it('every read decrypts: ciphertext, legacy plaintext and [erased] all come out readable', async () => {
    const rows = [
      {
        id: 1,
        chatId: CHAT_ID,
        content: await cipher.encrypt('I feel alone'),
        metadata: null,
      },
      { id: 2, chatId: CHAT_ID, content: 'legacy row', metadata: null },
      {
        id: 3,
        chatId: CHAT_ID,
        content: '[erased]',
        metadata: null,
        erasedAt: new Date(),
      },
    ];
    const { repository } = build(rows);
    const out = await repository.listForChat('t-1', CHAT_ID);
    expect(out.map((m) => m.content)).toEqual([
      'I feel alone',
      'legacy row',
      '[erased]',
    ]);
  });

  it('a staff DTO built from a read comes out decrypted', async () => {
    const row = {
      id: 7,
      chatId: CHAT_ID,
      tenantId: 't-1',
      type: HelplineMessageType.TEXT,
      senderRole: HelplineSenderRole.TALKER,
      senderUserId: null,
      systemKind: null,
      content: await cipher.encrypt('nobody would miss me'),
      parentMessageId: null,
      clientMessageId: null,
      visibleToTalker: true,
      metadata: null,
      createdAt: new Date(),
      erasedAt: null,
    };
    const { repository } = build([row]);
    const read = await repository.findById('t-1', CHAT_ID, 7);
    const dto = toStaffMessageDto(read as never, 'Asha');
    expect(dto.content).toBe('nobody would miss me');
    expect(JSON.stringify(dto)).not.toContain(HELPLINE_CIPHER_PREFIX);
  });
});

describe('other PHI columns are written encrypted', () => {
  const cipher = testCipher();

  it('talker feedback comment', async () => {
    const feedback = { insert: jest.fn().mockResolvedValue({}) };
    const service = new HelplineGuestService(
      {} as never,
      feedback as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      cipher,
    );
    await service.submitFeedback(
      { chat: { id: CHAT_ID, tenantId: 't-1', erasedAt: null } } as never,
      4,
      'thank you, it helped',
    );
    const row = feedback.insert.mock.calls[0][0];
    expect(HelplineContentCipher.isEncrypted(row.comment)).toBe(true);
    expect(await cipher.decrypt(row.comment)).toBe('thank you, it helped');
  });

  it('risk flag outcome note', async () => {
    const flag = { id: 'f-1', outcomeNote: null, acknowledgedBy: null };
    const flags = {
      findOne: jest.fn().mockResolvedValue(flag),
      save: jest.fn(async (f: unknown) => f),
    };
    const views = { riskFlags: jest.fn().mockResolvedValue([{ id: 'f-1' }]) };
    const service = new HelplineRiskService(
      flags as never,
      {} as never,
      {} as never,
      {} as never,
      views as never,
      { record: jest.fn() } as never,
      {} as never,
      { emit: jest.fn() } as never,
      cipher,
    );
    await service.acknowledge(
      { id: CHAT_ID, tenantId: 't-1', erasedAt: null } as never,
      'f-1',
      7,
      HelplineRiskOutcome.CONFIRMED,
      'spoke to their sister',
    );
    const saved = flags.save.mock.calls[0][0] as { outcomeNote: string };
    expect(HelplineContentCipher.isEncrypted(saved.outcomeNote)).toBe(true);
    expect(await cipher.decrypt(saved.outcomeNote)).toBe(
      'spoke to their sister',
    );
  });
});

describe('session creation stores the talker display name encrypted', () => {
  it('writes ciphertext and keeps using the plaintext name', async () => {
    const cipher = testCipher();
    const created: Record<string, unknown>[] = [];
    const manager = {
      create: (_: unknown, row: Record<string, unknown>) => row,
      save: jest.fn(async (row: Record<string, unknown>) => {
        created.push({ ...row });
        return { ...row, id: created.length === 1 ? 'tk-1' : CHAT_ID };
      }),
    };
    const views = { guestChat: jest.fn().mockResolvedValue({}) };
    const service = new HelplineSessionService(
      { transaction: (fn: (m: unknown) => unknown) => fn(manager) } as never,
      { count: jest.fn().mockResolvedValue(0) } as never,
      {
        countWaiting: jest.fn().mockResolvedValue(0),
        findById: jest.fn().mockResolvedValue(null),
      } as never,
      { listTalkerVisible: jest.fn().mockResolvedValue([]) } as never,
      {
        resolve: jest
          .fn()
          .mockResolvedValue({ id: 't-1', code: 'acme', name: 'Acme' }),
      } as never,
      {
        isEnabled: jest.fn().mockResolvedValue(true),
        getSettings: jest.fn().mockResolvedValue(HELPLINE_DEFAULT_SETTINGS),
      } as never,
      {
        availableListenerIds: jest.fn().mockResolvedValue([7]),
        touchConnection: jest.fn().mockResolvedValue(undefined),
      } as never,
      {
        hashIp: jest.fn().mockReturnValue(null),
        sign: jest
          .fn()
          .mockResolvedValue({ token: 'tok', expiresAt: new Date() }),
      } as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      views as never,
      {} as never,
      { queueChanged: jest.fn() } as never,
      cipher,
    );
    await service.createSession('acme', {
      displayName: 'Asha',
      language: 'en',
      consentVersion: HELPLINE_CONSENT_VERSION,
    });
    const talkerRow = created[0];
    expect(HelplineContentCipher.isEncrypted(talkerRow.displayName)).toBe(true);
    expect(await cipher.decrypt(talkerRow.displayName as string)).toBe('Asha');
    // The DTO is built from the plaintext.
    expect(views.guestChat.mock.calls[0][1].displayName).toBe('Asha');
  });
});
