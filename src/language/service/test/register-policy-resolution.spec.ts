import { LanguageGlossaryService } from '../language-glossary.service';
import { VarietyProfileStatus } from '../../entity/language-variety-profile.entity';

/**
 * resolveRegisterPolicy: the service half of phase 1.
 *
 * The property that matters is that a failure here costs the register LINE and
 * never the glossary — an agent with a slightly under-specified register is a
 * far better outcome than an agent with no language guidance at all.
 */
describe('LanguageGlossaryService.resolveRegisterPolicy', () => {
  let service: any;
  let languagesRepository: any;
  let profileRepository: any;
  let glossaryRepository: any;

  const build = () => {
    service = new LanguageGlossaryService(
      glossaryRepository,
      languagesRepository,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      profileRepository,
      {} as any,
      {} as any,
    );
  };

  beforeEach(() => {
    glossaryRepository = {
      findPublishedByLanguage: jest.fn().mockResolvedValue([]),
    };
    languagesRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 6,
        label: 'Tamil',
        evalConfig: { targetVariety: 'colloquial spoken Tamil' },
      }),
    };
    profileRepository = { findOne: jest.fn().mockResolvedValue(null) };
    build();
  });

  it('uses the seeded target variety when the tenant is unattached', async () => {
    const policy = await service.resolveRegisterPolicy(6);
    expect(policy).toContain('Speak colloquial spoken Tamil.');
    expect(profileRepository.findOne).not.toHaveBeenCalled();
  });

  it('enriches the descriptor from an attached variety profile', async () => {
    // This is the part that makes the instruction evidence-based: the profile's
    // measured address-form share and code-mix level ride along, so the agent
    // is told what that tenant's learners actually say.
    profileRepository.findOne.mockResolvedValue({
      id: 'p1',
      status: VarietyProfileStatus.CONFIRMED,
      features: {
        addressForms: { formalShare: 0.85 },
        codeMix: { latinTokenShare: 0.2 },
        characteristicLexemes: { method: 'frequency', items: [] },
      },
    });
    const policy = await service.resolveRegisterPolicy(6, 'p1');
    expect(policy).toContain('predominantly formal address (85%)');
    expect(policy).toContain('heavy English code-mix');
  });

  it('ignores an archived profile and falls back to the seeded variety', async () => {
    profileRepository.findOne.mockResolvedValue({
      id: 'p1',
      status: VarietyProfileStatus.ARCHIVED,
      features: {
        addressForms: { formalShare: 0.85 },
        codeMix: { latinTokenShare: 0.2 },
        characteristicLexemes: { method: 'frequency', items: [] },
      },
    });
    const policy = await service.resolveRegisterPolicy(6, 'p1');
    expect(policy).toContain('Speak colloquial spoken Tamil.');
    expect(policy).not.toContain('formal address');
  });

  it('returns empty rather than throwing when the language cannot be read', async () => {
    languagesRepository.findOne.mockRejectedValue(new Error('db down'));
    await expect(service.resolveRegisterPolicy(6)).resolves.toBe('');
  });

  it('returns empty for an unknown language', async () => {
    languagesRepository.findOne.mockResolvedValue(null);
    await expect(service.resolveRegisterPolicy(999)).resolves.toBe('');
  });

  it('serves the card with the policy leading', async () => {
    glossaryRepository.findPublishedByLanguage.mockResolvedValue([
      {
        sectionCode: 'core_style',
        title: 'Core style',
        content: 'be warm and brief',
        status: 'published',
        injectionMode: 'always',
      },
    ]);
    const card = await service.resolveTier0Glossary(6);
    expect(card.indexOf('## Register')).toBe(0);
    expect(card).toContain('be warm and brief');
  });

  it('a glossary-less language still gets its register instruction', async () => {
    const card = await service.resolveTier0Glossary(6);
    expect(card).toContain('Speak colloquial spoken Tamil.');
  });
});
