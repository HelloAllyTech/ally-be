import { UserStatus } from 'src/user/constants/user-status.constants';
import { User } from 'src/user/entity/user.entity';

export const getSessionDurationInSeconds = (startDate: Date, endDate: Date) => {
  return startDate && endDate
    ? Math.max(
        0,
        Math.floor(
          (new Date(endDate).getTime() - new Date(startDate).getTime()) / 1000,
        ),
      )
    : 0;
};

export const formatCreatedUserDetails = (user: User) => {
  return {
    id: user.id,
    ...(user.status === UserStatus.SUSPENDED
      ? {
          name: 'Suspended User',
          profileImage: null,
        }
      : {
          name: user.name,
          profileImage: user.profileImageUrl ?? null,
        }),
  };
};
