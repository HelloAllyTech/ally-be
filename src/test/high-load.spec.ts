describe('High load simulation', () => {
  it('should not time out under high load', async () => {
    const promises = [];
    for (let i = 0; i < 1000; i++) {
      promises.push(
        new Promise<void>((resolve) => {
          setTimeout(() => {
            resolve();
          }, 10);
        }),
      );
    }
    await Promise.all(promises);
  });
});
