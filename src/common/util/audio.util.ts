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

export function generateAudioStorageKey(params: {
  chatId?: number;
  key?: string;
  extension?: string;
  prefix?: string;
}): string {
  const { chatId, key, extension, prefix } = params;
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const timestamp = now.getTime();
  const defaultKey = `chat-${chatId}-${timestamp}`;
  const finalKey = key || defaultKey;
  return `${prefix ? `${prefix}/` : ''}${year}/${month}/${day}/${finalKey}${
    extension ? `.${extension}` : ''
  }`;
}
