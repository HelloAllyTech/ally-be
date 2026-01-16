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
