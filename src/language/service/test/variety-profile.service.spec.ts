import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VarietyProfileStatus } from '../../entity/language-variety-profile.entity';
import { VarietyProfileService } from '../variety-profile.service';

const tamil = { id: 6, value: 'ta-IN', label: 'Tamil (India)' };

/** 12 tokens each — comfortably inside exemplar bounds. */
const tenantTurn =
  'நீங்க சரி டாக்டர் கிட்ட போங்க ஷுகர் மாத்திரை சாப்பிடுங்க சரி நல்லது வணக்கம் ஓகே';
const contrastTurn =
  'நீ வா மருந்து சாப்பிடு தல வலி இருக்கு ரொம்ப கஷ்டம் தூக்கம் வரல அம்மா';

describe('VarietyProfileService', () => {
  let service: VarietyProfileService;
  let profileRepository: any;
  let attachmentRepository: any;
  let languagesRepository: any;
  let dataSource: any;

  /** Queues raw-SQL results in call order: sessions, tenant turns, contrast turns. */
  const queueQueries = (results: any[][]) => {
    results.forEach((rows) => dataSource.query.mockResolvedValueOnce(rows));
  };

  const sessionRows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ sid: `s-${i}` }));
  const turnRows = (n: number, content: string) =>
    Array.from({ length: n }, () => ({ content }));

  beforeEach(() => {
    profileRepository = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => ({ id: 'profile-1', ...v })),
    };
    attachmentRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => ({ id: 'att-1', ...v })),
    };
    languagesRepository = { findOne: jest.fn().mockResolvedValue(tamil) };
    dataSource = { query: jest.fn() };
    service = new VarietyProfileService(
      profileRepository,
      attachmentRepository,
      languagesRepository,
      dataSource,
    );
  });

  it('404s on an unknown language', async () => {
    languagesRepository.findOne.mockResolvedValue(null);
    await expect(service.inferProfile(99, 't-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('refuses to infer from too little data', async () => {
    queueQueries([sessionRows(3), turnRows(50, tenantTurn)]);
    await expect(service.inferProfile(6, 't-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('creates a profile + attachment when nothing matches', async () => {
    queueQueries([
      sessionRows(20),
      turnRows(300, tenantTurn),
      turnRows(300, contrastTurn),
    ]);

    const result = await service.inferProfile(6, 't-1', 90, 'admin');

    expect(result.matched).toBe(false);
    expect(result.profile.status).toBe(VarietyProfileStatus.INFERRED);
    expect(result.profile.features.characteristicLexemes.method).toBe(
      'log_odds',
    );
    // The tenant's distinctive term beats the shared/contrast vocabulary.
    expect(
      result.profile.features.characteristicLexemes.items.map((i) => i.token),
    ).toContain('ஷுகர்');
    expect(result.profile.source!.inferredFromTenantId).toBe('t-1');
    expect(result.profile.description).toContain('judged sessions');
    expect(result.profile.exemplars.length).toBeGreaterThan(0);

    const attachment = attachmentRepository.save.mock.calls.at(-1)[0];
    expect(attachment.profileId).toBe('profile-1');
    expect(attachment.tenantId).toBe('t-1');
    expect(attachment.languageId).toBe(6);
    expect(attachment.attachedBy).toBe('inferred');
  });

  it('attaches to an existing profile above the similarity threshold', async () => {
    queueQueries([
      sessionRows(20),
      turnRows(300, tenantTurn),
      turnRows(300, contrastTurn),
    ]);
    // Seed an existing profile by running inference once against empty state,
    // then feed its features back as the stored profile.
    const first = await service.inferProfile(6, 't-1');
    profileRepository.find.mockResolvedValue([
      {
        id: 'existing-1',
        status: VarietyProfileStatus.INFERRED,
        features: first.profile.features,
      },
    ]);
    profileRepository.save.mockClear();

    queueQueries([
      sessionRows(20),
      turnRows(300, tenantTurn),
      turnRows(300, contrastTurn),
    ]);
    const second = await service.inferProfile(6, 't-2');

    expect(second.matched).toBe(true);
    expect(second.profile.id).toBe('existing-1');
    expect(second.similarity).toBeGreaterThanOrEqual(0.75);
    expect(profileRepository.save).not.toHaveBeenCalled();
    const attachment = attachmentRepository.save.mock.calls.at(-1)[0];
    expect(attachment.profileId).toBe('existing-1');
    expect(attachment.similarity).toBe(second.similarity);
  });

  it('never matches archived profiles', async () => {
    queueQueries([
      sessionRows(20),
      turnRows(300, tenantTurn),
      turnRows(300, contrastTurn),
    ]);
    const first = await service.inferProfile(6, 't-1');
    profileRepository.find.mockResolvedValue([
      {
        id: 'archived-1',
        status: VarietyProfileStatus.ARCHIVED,
        features: first.profile.features,
      },
    ]);

    queueQueries([
      sessionRows(20),
      turnRows(300, tenantTurn),
      turnRows(300, contrastTurn),
    ]);
    const second = await service.inferProfile(6, 't-2');
    expect(second.matched).toBe(false);
  });

  it('re-points the existing attachment instead of stacking rows', async () => {
    attachmentRepository.findOne.mockResolvedValue({
      id: 'att-old',
      profileId: 'old-profile',
      tenantId: 't-1',
      languageId: 6,
    });
    queueQueries([
      sessionRows(20),
      turnRows(300, tenantTurn),
      turnRows(300, contrastTurn),
    ]);

    await service.inferProfile(6, 't-1');

    const attachment = attachmentRepository.save.mock.calls.at(-1)[0];
    expect(attachment.id).toBe('att-old');
    expect(attachment.profileId).toBe('profile-1');
  });

  it('falls back to frequency lexemes when no contrast corpus exists', async () => {
    queueQueries([sessionRows(20), turnRows(300, tenantTurn), []]);
    const result = await service.inferProfile(6, 't-1');
    expect(result.profile.features.characteristicLexemes.method).toBe(
      'frequency',
    );
    expect(result.profile.description).toContain('no contrast corpus');
  });

  it('excludes test tenants from the contrast query', async () => {
    queueQueries([
      sessionRows(20),
      turnRows(300, tenantTurn),
      turnRows(300, contrastTurn),
    ]);
    await service.inferProfile(6, 't-1');
    const contrastSql = dataSource.query.mock.calls[2][0] as string;
    expect(contrastSql).toContain('"isTestOrganization" = true');
  });

  it("matches the tenant's own sessions by id or code (dual-key), not plain equality", async () => {
    queueQueries([
      sessionRows(20),
      turnRows(300, tenantTurn),
      turnRows(300, contrastTurn),
    ]);
    await service.inferProfile(6, 't-1');
    const sessionsSql = dataSource.query.mock.calls[0][0] as string;
    // A tenant stored under its code (or its uuid) elsewhere must still match
    // here — plain `ljs.tenant_id = $2` only recognizes one of the two forms.
    expect(sessionsSql).not.toMatch(/ljs\.tenant_id\s*=\s*\$2/);
    expect(sessionsSql).toContain('st.id::text = $2');
    expect(sessionsSql).toContain('st.code = $2');
  });

  it("excludes the tenant's own sessions from the contrast corpus by id or code (dual-key)", async () => {
    queueQueries([
      sessionRows(20),
      turnRows(300, tenantTurn),
      turnRows(300, contrastTurn),
    ]);
    await service.inferProfile(6, 't-1');
    const contrastSql = dataSource.query.mock.calls[2][0] as string;
    expect(contrastSql).not.toMatch(/ljs\.tenant_id\s*<>\s*\$2/);
    expect(contrastSql).toContain('st.id::text = $2');
    expect(contrastSql).toContain('st.code = $2');
  });

  describe('listProfiles', () => {
    it('groups attachments under their profiles', async () => {
      profileRepository.find.mockResolvedValue([
        { id: 'p1', languageId: 6 },
        { id: 'p2', languageId: 6 },
      ]);
      dataSource.query.mockResolvedValue([]);
      attachmentRepository.find.mockResolvedValue([
        { id: 'a1', profileId: 'p1' },
        { id: 'a2', profileId: 'p2' },
        { id: 'a3', profileId: 'p1' },
      ]);
      const views = await service.listProfiles(6);
      expect(views).toHaveLength(2);
      expect(views[0].attachments.map((a: any) => a.id)).toEqual(['a1', 'a3']);
      expect(views[1].attachments.map((a: any) => a.id)).toEqual(['a2']);
    });
  });
});
