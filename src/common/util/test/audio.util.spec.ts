import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock LoggerService
const mockLoggerInstance = {
  error: jest.fn(),
};

jest.doMock('../../../logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => mockLoggerInstance),
  },
}));

describe('AudioUtil', () => {
  let checkAudioFileReady: any;

  beforeAll(async () => {
    const audioUtil = await import('../audio.util');
    checkAudioFileReady = audioUtil.checkAudioFileReady;
  });

  describe('checkAudioFileReady', () => {
    it('should return true when audio file is ready (status 200)', async () => {
      const audioUrl = 'https://example.com/audio.mp3';
      mockedAxios.head.mockResolvedValue({ status: 200 });

      const result = await checkAudioFileReady(audioUrl);

      expect(mockedAxios.head).toHaveBeenCalledWith(audioUrl, {
        timeout: 5000,
      });
      expect(result).toBe(true);
    });

    it('should return false when audio file is not ready (non-200 status)', async () => {
      const audioUrl = 'https://example.com/audio.mp3';
      mockedAxios.head.mockResolvedValue({ status: 404 });

      const result = await checkAudioFileReady(audioUrl);

      expect(mockedAxios.head).toHaveBeenCalledWith(audioUrl, {
        timeout: 5000,
      });
      expect(result).toBe(false);
    });

    it('should return false and log error when request fails', async () => {
      const audioUrl = 'https://example.com/audio.mp3';
      const error = new Error('Network error');
      mockedAxios.head.mockRejectedValue(error);

      const result = await checkAudioFileReady(audioUrl);

      expect(mockedAxios.head).toHaveBeenCalledWith(audioUrl, {
        timeout: 5000,
      });
      expect(mockLoggerInstance.error).toHaveBeenCalledWith(
        `Error checking audio file ready: ${error}`,
      );
      expect(result).toBe(false);
    });
  });
});
