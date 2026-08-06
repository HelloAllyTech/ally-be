import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IsAllowedRoles } from '../allowed-roles.decorator';
import { UserRole } from '../../constants/user.constants';

class AuthRequest {
  @IsAllowedRoles()
  allowedRoles!: UserRole[];
}

/** Mirrors the global pipe: `new ValidationPipe({ transform: true })`. */
const parse = (allowedRoles: unknown) => {
  const dto = plainToInstance(AuthRequest, { allowedRoles });
  return { dto, errors: validateSync(dto) };
};

describe('IsAllowedRoles', () => {
  it('accepts a list of known roles unchanged', () => {
    const { dto, errors } = parse([UserRole.COUNSELOR, UserRole.LEARNER]);

    expect(errors).toHaveLength(0);
    expect(dto.allowedRoles).toEqual([UserRole.COUNSELOR, UserRole.LEARNER]);
  });

  // The 2026-08-06 outage: a client build still listing the removed INTERNAL
  // role must keep logging its other roles in, not 400 the whole request.
  it('drops a retired role and admits the rest', () => {
    const { dto, errors } = parse([
      UserRole.COUNSELOR,
      UserRole.ADMIN,
      UserRole.LEARNER,
      UserRole.SIMULATION_REVIEWER,
      UserRole.SCRIBE_REVIEWER,
      'INTERNAL',
    ]);

    expect(errors).toHaveLength(0);
    expect(dto.allowedRoles).toEqual([
      UserRole.COUNSELOR,
      UserRole.ADMIN,
      UserRole.LEARNER,
      UserRole.SIMULATION_REVIEWER,
      UserRole.SCRIBE_REVIEWER,
    ]);
  });

  it('drops non-string entries', () => {
    const { dto, errors } = parse([UserRole.LEARNER, 42, null, { a: 1 }]);

    expect(errors).toHaveLength(0);
    expect(dto.allowedRoles).toEqual([UserRole.LEARNER]);
  });

  it('rejects a list with no recognisable role', () => {
    const { errors } = parse(['INTERNAL', 'NOT_A_ROLE']);

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('arrayNotEmpty');
  });

  it('rejects an empty list', () => {
    const { errors } = parse([]);

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('arrayNotEmpty');
  });

  it.each([
    ['a missing value', undefined],
    ['a non-array value', UserRole.LEARNER],
  ])('rejects %s', (_label, value) => {
    const { errors } = parse(value);

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isArray');
  });
});
