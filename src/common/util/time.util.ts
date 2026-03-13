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
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  // If duration is less than 1 hour, return mm:ss format
  if (hours === 0) {
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // If duration is 1 hour or more, return hh:mm:ss format
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Parses timestamp strings in formats: [mm:ss], [m:ss], [hh:mm:ss], [h:mm:ss]
 * Returns the timestamp in seconds
 */
export const parseTimestampToSeconds = (timestamp: string): number | null => {
  // Remove brackets if present
  const cleaned = timestamp.replace(/[\[\]]/g, '');

  // Match formats: mm:ss, m:ss, hh:mm:ss, h:mm:ss
  const parts = cleaned.split(':');

  if (parts.length === 2) {
    // Format: mm:ss or m:ss
    const minutes = parseInt(parts[0], 10);
    const seconds = parseInt(parts[1], 10);
    if (isNaN(minutes) || isNaN(seconds)) return null;
    return minutes * 60 + seconds;
  } else if (parts.length === 3) {
    // Format: hh:mm:ss or h:mm:ss
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseInt(parts[2], 10);
    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) return null;
    return hours * 3600 + minutes * 60 + seconds;
  }

  return null;
};

/**
 * Extracts all timestamp references from text in formats: [mm:ss], [m:ss], [hh:mm:ss], [h:mm:ss]
 * Returns an array of unique timestamps in seconds
 */
export const extractTimestampsFromText = (text: string): number[] => {
  // Regex to match timestamps in brackets: [mm:ss], [m:ss], [hh:mm:ss], [h:mm:ss]
  const timestampRegex = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;
  const matches = text.matchAll(timestampRegex);
  const timestamps: number[] = [];

  const timestampsSet = new Set<number>();
  for (const match of matches) {
    const seconds = parseTimestampToSeconds(match[1]);
    if (seconds !== null && !timestampsSet.has(seconds)) {
      timestampsSet.add(seconds);
      timestamps.push(seconds);
    }
  }

  return timestamps.sort((a, b) => a - b);
};
