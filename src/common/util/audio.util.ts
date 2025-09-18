import axios from 'axios';

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
      console.error(`Error checking audio file ready: ${error}`);
      return false;
    });
}
