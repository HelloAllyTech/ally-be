export const parseTimeToSeconds = (timeString: string): number => {
  if (!isValidTimeFormatHHMMSS(timeString)) {
    throw new Error(
      `Invalid time format. Expected HH:MM:SS, got: ${timeString}`,
    );
  }
  const [hours, minutes, seconds] = timeString.split(':').map(Number);
  return hours * 3600 + minutes * 60 + seconds;
};

export const isValidTimeFormatHHMMSS = (timeString: string): boolean => {
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])$/;
  return timeRegex.test(timeString);
};

export const formatSecondsToMMSS = (seconds?: number | null): string | null => {
  if (seconds == null) return null;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};
