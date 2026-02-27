import * as ffmpeg from 'fluent-ffmpeg';
import { PassThrough } from 'stream';

export type AudioFormat = 'mp3' | 'wav' | 'unknown';

export function detectAudioFormat(buffer: Buffer): AudioFormat {
  if (buffer.length < 4) return 'unknown';

  // WAV: starts with "RIFF"
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46
  ) {
    return 'wav';
  }

  // MP3: starts with 0xFF 0xFB, 0xFF 0xF3, 0xFF 0xF2, or "ID3"
  if (
    buffer[0] === 0xff &&
    (buffer[1] === 0xfb || buffer[1] === 0xf3 || buffer[1] === 0xf2)
  ) {
    return 'mp3';
  }
  if (
    buffer[0] === 0x49 &&
    buffer[1] === 0x44 &&
    buffer[2] === 0x33 // "ID3"
  ) {
    return 'mp3';
  }

  return 'unknown';
}

function convertWithFfmpeg(
  inputBuffer: Buffer,
  inputOptions: string[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const inputStream = new PassThrough();
    inputStream.end(inputBuffer);

    const outputChunks: Buffer[] = [];
    const outputStream = new PassThrough();
    outputStream.on('data', (chunk: Buffer) => outputChunks.push(chunk));
    outputStream.on('end', () => resolve(Buffer.concat(outputChunks)));
    outputStream.on('error', reject);

    const command = ffmpeg(inputStream);
    for (const opt of inputOptions) {
      command.inputOption(opt);
    }
    command
      .format('mp3')
      .audioBitrate(128)
      .on('error', reject)
      .pipe(outputStream, { end: true });
  });
}

/**
 * Convert raw PCM audio (signed 16-bit little-endian) to MP3.
 */
export function pcmToMp3(
  buffer: Buffer,
  sampleRate = 24000,
  channels = 1,
): Promise<Buffer> {
  return convertWithFfmpeg(buffer, [
    '-f s16le',
    `-ar ${sampleRate}`,
    `-ac ${channels}`,
  ]);
}

/**
 * Convert WAV audio to MP3.
 */
export function wavToMp3(buffer: Buffer): Promise<Buffer> {
  return convertWithFfmpeg(buffer, []);
}
