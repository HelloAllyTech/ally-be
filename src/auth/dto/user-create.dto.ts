import {
  IsEmail,
  IsString,
  MinLength,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { UserRole } from '../../common/constants/user.constants';
import { PASSWORD_VALIDATION } from '../../common/constants/validation.constants';

export class UserCreateDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(PASSWORD_VALIDATION.MIN_LENGTH)
  //@Matches(PASSWORD_VALIDATION.REGEX)
  password!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsString()
  username?: string;
}
