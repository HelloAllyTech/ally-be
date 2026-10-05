import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TRACK_MAX_COMPETENCIES } from '../../constants/track.constant';
import { CreateTrackDto } from '../create-track.dto';
import { UpdateTrackDto } from '../update-track.dto';

// Real v4 uuids (version nibble 4, variant 8..b) — the seeded competency ids
// are uuid_generate_v4() output, and the DTO mirrors the scenario DTO's
// `@IsUUID('4', { each: true })`.
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const competencyErrors = async (
  Dto: typeof CreateTrackDto | typeof UpdateTrackDto,
  body: Record<string, unknown>,
) => {
  const errors = await validate(plainToInstance(Dto, body));
  return errors.find((error) => error.property === 'competencyIds');
};

describe.each([
  ['CreateTrackDto', CreateTrackDto],
  ['UpdateTrackDto', UpdateTrackDto],
])('%s competencyIds', (_name, Dto) => {
  it('is optional: absent, null and [] all validate', async () => {
    expect(await competencyErrors(Dto, { title: 'T' })).toBeUndefined();
    expect(
      await competencyErrors(Dto, { title: 'T', competencyIds: null }),
    ).toBeUndefined();
    expect(
      await competencyErrors(Dto, { title: 'T', competencyIds: [] }),
    ).toBeUndefined();
  });

  it('accepts up to the ceiling of v4 uuids', async () => {
    const ids = Array.from({ length: TRACK_MAX_COMPETENCIES }, (_, n) =>
      id(n + 1),
    );
    expect(
      await competencyErrors(Dto, { title: 'T', competencyIds: ids }),
    ).toBeUndefined();
  });

  it('rejects one past the ceiling', async () => {
    const ids = Array.from({ length: TRACK_MAX_COMPETENCIES + 1 }, (_, n) =>
      id(n + 1),
    );
    const error = await competencyErrors(Dto, {
      title: 'T',
      competencyIds: ids,
    });
    expect(error?.constraints).toHaveProperty('arrayMaxSize');
  });

  it('rejects a non-uuid id', async () => {
    const error = await competencyErrors(Dto, {
      title: 'T',
      competencyIds: [id(1), 'empathy'],
    });
    expect(error?.constraints).toHaveProperty('isUuid');
  });

  it('rejects a repeated id', async () => {
    const error = await competencyErrors(Dto, {
      title: 'T',
      competencyIds: [id(1), id(1)],
    });
    expect(error?.constraints).toHaveProperty('arrayUnique');
  });

  it('rejects a bare string in place of an array', async () => {
    const error = await competencyErrors(Dto, {
      title: 'T',
      competencyIds: id(1),
    });
    expect(error?.constraints).toHaveProperty('isArray');
  });
});
