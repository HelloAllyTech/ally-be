import { UserRole } from '../../common/constants/user.constants';

export type TokenUser = {
  id: number;
  username: string;
  role: UserRole;
};
