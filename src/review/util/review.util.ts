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

/**
 * Active session duration in seconds, excluding paused time. Mirrors the
 * billing/leaderboard computation (wall-clock minus totalPausedMs and any
 * still-open pause interval) so every surface reports the same "minutes
 * actually practiced". Sessions without pause data fall back to wall-clock.
 */
export const getActiveSessionDurationSeconds = (
  startDate: Date,
  endDate: Date,
  totalPausedMs: number | null = 0,
  pausedAt?: Date | null,
) => {
  const wallSeconds = getSessionDurationInSeconds(startDate, endDate);
  let pausedMs = totalPausedMs ?? 0;
  if (pausedAt && endDate) {
    // Close an interval left open if the session ended while still paused.
    pausedMs += Math.max(
      0,
      new Date(endDate).getTime() - new Date(pausedAt).getTime(),
    );
  }
  return Math.max(0, wallSeconds - Math.round(pausedMs / 1000));
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
