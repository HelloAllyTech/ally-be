import axios from 'axios';
import { LoggerService } from '../../logger/logger.service';

const logger = LoggerService.getInstance('AudioUtil');

export function checkAudioFileReady(audioUrl: string): Promise<boolean> {
  return axios
    .head(audioUrl, { timeout: 5000 })
    .then((response) => {
      if (response.status === 200) {
        return true;
      }
      return false;
    })
    .catch((error) => {
      logger.error(`Error checking audio file ready: ${error}`);
      return false;
    });
}
