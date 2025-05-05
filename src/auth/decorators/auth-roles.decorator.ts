import { applyDecorators, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport'; // or your custom guard
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from './roles.decorator';
import { UserRole } from '../../common/constants/user.constants';

export function AuthRoles(...roles: UserRole[]) {
  return applyDecorators(
    UseGuards(AuthGuard('jwt'), RolesGuard),
    Roles(...roles),
  );
}
