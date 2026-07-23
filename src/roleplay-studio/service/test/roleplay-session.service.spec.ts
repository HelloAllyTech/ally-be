import { ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RoleplaySessionService } from '../roleplay-session.service';
import { AppConfigService } from '../../../config/config.service';

/**
 * Focused on the v2 rollout gate (assertRoleplayV2Allowed) — the flag+allowlist
 * choke point every v2 session start passes through. The heavier session-start
 * plumbing is exercised elsewhere; here we pin the gate matrix.
 */
describe('RoleplaySessionService — v2 rollout gate', () => {
  const SANDEEP = 'sandeep.malhotra@helloally.ai';

  const makeService = (
    roleplayV2: { enabled: boolean; allowlist: string[] },
    user: { id: number; email: string } | null,
  ) => {
    const findOne = jest.fn().mockResolvedValue(user);
    const configService = { roleplayV2 } as unknown as AppConfigService;
    const dataSource = {
      getRepository: () => ({ findOne }),
    } as unknown as DataSource;
    const service = new RoleplaySessionService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      configService,
      dataSource,
    );
    return { service, findOne };
  };

  const assertAllowed = (service: RoleplaySessionService, userId: number) =>
    (service as any).assertRoleplayV2Allowed(userId) as Promise<void>;

  it('blocks EVERYONE (incl. an allowlisted user) when the flag is off', async () => {
    const { service } = makeService(
      { enabled: false, allowlist: [SANDEEP] },
      { id: 1, email: SANDEEP },
    );
    await expect(assertAllowed(service, 1)).rejects.toThrow(ForbiddenException);
  });

  it('allows an allowlisted user when the flag is on', async () => {
    const { service } = makeService(
      { enabled: true, allowlist: [SANDEEP] },
      { id: 1, email: SANDEEP },
    );
    await expect(assertAllowed(service, 1)).resolves.toBeUndefined();
  });

  it('blocks a non-allowlisted user even when the flag is on', async () => {
    const { service } = makeService(
      { enabled: true, allowlist: [SANDEEP] },
      { id: 2, email: 'someone.else@helloally.ai' },
    );
    await expect(assertAllowed(service, 2)).rejects.toThrow(ForbiddenException);
  });

  it('blocks when the user cannot be resolved', async () => {
    const { service } = makeService(
      { enabled: true, allowlist: [SANDEEP] },
      null,
    );
    await expect(assertAllowed(service, 999)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('matches the allowlist case-insensitively', async () => {
    const { service } = makeService(
      { enabled: true, allowlist: [SANDEEP] },
      { id: 1, email: '  Sandeep.Malhotra@HelloAlly.ai ' },
    );
    await expect(assertAllowed(service, 1)).resolves.toBeUndefined();
  });

  it.each([
    'sandeep.malhotra+admin@helloally.ai',
    'sandeep.malhotra+learner@helloally.ai',
    'sandeep.malhotra+anything.else@helloally.ai',
  ])(
    'allows +tag sub-addresses of an allowlisted base email (%s)',
    async (email) => {
      const { service } = makeService(
        { enabled: true, allowlist: [SANDEEP] },
        { id: 1, email },
      );
      await expect(assertAllowed(service, 1)).resolves.toBeUndefined();
    },
  );

  it('does not let a +tag match a DIFFERENT base email', async () => {
    const { service } = makeService(
      { enabled: true, allowlist: [SANDEEP] },
      { id: 2, email: 'someone.else+admin@helloally.ai' },
    );
    await expect(assertAllowed(service, 2)).rejects.toThrow(ForbiddenException);
  });
});

describe('RoleplaySessionService — room-metadata specFetch URL', () => {
  const makeService = (opts: { inline: boolean }) => {
    const specCompiler = {
      compileWithInfo: jest.fn(() => ({
        compiled: { title: 'spec' },
        inline: opts.inline,
        sizeBytes: opts.inline ? 1024 : 100 * 1024,
      })),
    };
    const configService = {
      api: { baseUrl: 'https://api.example/' },
    } as unknown as AppConfigService;
    return new RoleplaySessionService(
      {} as any,
      specCompiler as any,
      {} as any,
      {} as any,
      {} as any,
      configService,
      {} as any,
    );
  };

  const build = (service: RoleplaySessionService) =>
    (service as any).buildRoomMetadata({
      document: { specSchemaVersion: '1.0' },
      version: { id: 'ver-1' },
      spec: { id: 'spec-1' },
      scenarioSession: { id: 'sess-1' },
      userId: 7,
      language: {},
      voice: { id: 'v', name: 'n', provider: 'p', config: null },
    }) as Record<string, any>;

  // Must carry the setGlobalPrefix('api') segment — the v2 agent's
  // ensure_spec 404s without it. The identical bug in the learn
  // room-metadata URL stranded all sessions on 2026-07-23 (9fcf495f).
  it('points specFetch at the /api/v1 webhook for oversized specs', () => {
    const metadata = build(makeService({ inline: false }));
    expect(metadata.spec).toBeNull();
    expect(metadata.specFetch).toEqual({
      versionId: 'ver-1',
      url: 'https://api.example/api/v1/roleplay-studio/webhook/spec-versions/ver-1',
    });
  });

  it('inlines small specs with no specFetch pointer', () => {
    const metadata = build(makeService({ inline: true }));
    expect(metadata.spec).toEqual({ title: 'spec' });
    expect(metadata.specFetch).toBeNull();
  });
});
