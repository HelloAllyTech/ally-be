import { BadRequestException } from '@nestjs/common';
import { TrackMediaService } from '../track-media.service';
import { TrackMediaKind } from '../../constants/track.constant';

const MB = 1024 * 1024;

describe('TrackMediaService.getPresignedUploadUrl', () => {
  let service: TrackMediaService;
  let generatePresignedUrl: jest.Mock;

  beforeEach(() => {
    generatePresignedUrl = jest.fn().mockResolvedValue('https://presigned');
    service = new TrackMediaService(
      {
        s3: { learnMediaPublicBucket: 'ally-media' },
        aws: { region: 'ap-south-1' },
      } as any,
      {
        generatePresignedUrl,
        sanitizeFileName: (name: string) => name,
      } as any,
    );
  });

  const request = (overrides: Record<string, unknown> = {}) =>
    service.getPresignedUploadUrl({
      fileName: 'wound.png',
      fileSize: 1 * MB,
      contentType: 'image/png',
      kind: TrackMediaKind.QUESTION_IMAGE,
      ...overrides,
    } as any);

  it('mints a URL for a question image under the limit', async () => {
    const result = await request();
    expect(result.presignedUrl).toBe('https://presigned');
    expect(result.publicUrl).toContain('track-media/question_image/');
  });

  /**
   * The point of the separate question kinds: a lesson video may be 500MB,
   * but the same file attached to a question is 10x over its own cap.
   */
  it('caps a question image well below a lesson image', async () => {
    await expect(request({ fileSize: 6 * MB })).rejects.toThrow(
      /less than 5 MB/,
    );
    await expect(
      request({ fileSize: 6 * MB, kind: TrackMediaKind.IMAGE }),
    ).resolves.toBeDefined();
  });

  it('caps a question video well below a lesson video', async () => {
    const video = {
      fileName: 'clip.mp4',
      contentType: 'video/mp4',
      kind: TrackMediaKind.QUESTION_VIDEO,
    };
    await expect(request({ ...video, fileSize: 60 * MB })).rejects.toThrow(
      /less than 50 MB/,
    );
    await expect(
      request({ ...video, kind: TrackMediaKind.VIDEO, fileSize: 60 * MB }),
    ).resolves.toBeDefined();
  });

  it('caps question video duration at three minutes', async () => {
    const video = {
      fileName: 'clip.mp4',
      fileSize: 1 * MB,
      contentType: 'video/mp4',
      kind: TrackMediaKind.QUESTION_VIDEO,
    };
    await expect(request({ ...video, duration: 200 })).rejects.toThrow(
      /less than 3 minutes/,
    );
    await expect(request({ ...video, duration: 170 })).resolves.toBeDefined();
  });

  it('rejects a content type the kind does not allow', async () => {
    await expect(
      request({ contentType: 'application/pdf' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      request({
        kind: TrackMediaKind.QUESTION_VIDEO,
        contentType: 'image/png',
      }),
    ).rejects.toThrow(/Invalid file type/);
  });

  it('still honours the unchanged lesson limits', async () => {
    await expect(
      request({ kind: TrackMediaKind.IMAGE, fileSize: 11 * MB }),
    ).rejects.toThrow(/less than 10 MB/);
    await expect(
      request({
        kind: TrackMediaKind.VIDEO,
        fileName: 'lesson.mp4',
        contentType: 'video/mp4',
        fileSize: 1 * MB,
        duration: 31 * 60,
      }),
    ).rejects.toThrow(/less than 30 minutes/);
  });
});
