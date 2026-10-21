import { ForbiddenException } from '@nestjs/common';
import { TrackAdminController } from '../track-admin.controller';

/**
 * Every route that changes an existing course runs TrackService's ownership
 * check first, so an organization-restricted admin cannot change a course
 * someone else created (see TrackService.assertCallerMayEdit). The check
 * itself is covered in track.service.spec; this pins the wiring.
 */
describe('TrackAdminController — course ownership for restricted admins', () => {
  const TRACK_ID = '0b7f3c52-3a39-4f55-9a52-4a3c0f1f5a10';
  let trackService: Record<string, jest.Mock>;
  let trackTranslationService: Record<string, jest.Mock>;
  let controller: TrackAdminController;
  let trackMediaService: { deleteMedia: jest.Mock };

  beforeEach(() => {
    trackService = {
      assertCallerMayEdit: jest
        .fn()
        .mockRejectedValue(
          new ForbiddenException('You can only edit your own courses'),
        ),
      assertCallerMayMakeGlobal: jest.fn().mockResolvedValue(undefined),
      assertCallerMayDeleteMedia: jest
        .fn()
        .mockRejectedValue(new ForbiddenException()),
      createTrack: jest.fn(),
      updateTrack: jest.fn(),
      upsertStructure: jest.fn(),
      deleteTrack: jest.fn(),
      duplicateTrack: jest.fn(),
    };
    trackTranslationService = {
      setLanguages: jest.fn(),
      translate: jest.fn(),
      updateFields: jest.fn(),
      markReviewed: jest.fn(),
      setMediaUrl: jest.fn(),
      publish: jest.fn(),
      unpublish: jest.fn(),
    };
    trackMediaService = { deleteMedia: jest.fn() };
    controller = new TrackAdminController(
      trackService as any,
      {} as any,
      trackMediaService as any,
      trackTranslationService as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  const editingRoutes: [string, () => Promise<unknown>][] = [
    ['updateTrack', () => controller.updateTrack(TRACK_ID, {})],
    [
      'upsertTrackStructure',
      () => controller.upsertTrackStructure(TRACK_ID, { sections: [] } as any),
    ],
    [
      'setTrackLanguages',
      () => controller.setTrackLanguages(TRACK_ID, { languageIds: [] }),
    ],
    [
      'translateTrack',
      () => controller.translateTrack(TRACK_ID, { languageIds: [] } as any),
    ],
    [
      'updateTrackTranslationFields',
      () =>
        controller.updateTrackTranslationFields(TRACK_ID, 2, {
          edits: [],
        } as any),
    ],
    [
      'reviewTrackTranslation',
      () => controller.reviewTrackTranslation(TRACK_ID, 2, {} as any),
    ],
    [
      'setTrackTranslationMedia',
      () => controller.setTrackTranslationMedia(TRACK_ID, 2, {} as any),
    ],
    [
      'publishTrackTranslation',
      () => controller.publishTrackTranslation(TRACK_ID, 2),
    ],
    [
      'unpublishTrackTranslation',
      () => controller.unpublishTrackTranslation(TRACK_ID, 2),
    ],
    ['deleteTrack', () => controller.deleteTrack(TRACK_ID)],
    ['duplicateTrack', () => controller.duplicateTrack(TRACK_ID)],
  ];

  it.each(editingRoutes)(
    '%s refuses before touching the course',
    async (_route, call) => {
      await expect(call()).rejects.toThrow(ForbiddenException);
      expect(trackService.assertCallerMayEdit).toHaveBeenCalledWith(TRACK_ID);
      for (const mock of [
        ...Object.values(trackTranslationService),
        trackService.updateTrack,
        trackService.upsertStructure,
        trackService.deleteTrack,
        trackService.duplicateTrack,
      ]) {
        expect(mock).not.toHaveBeenCalled();
      }
    },
  );

  it('refuses to create a global course for a restricted admin', async () => {
    trackService.assertCallerMayMakeGlobal.mockRejectedValue(
      new ForbiddenException(),
    );

    await expect(
      controller.createTrack({ title: 'T', isGlobal: true } as any),
    ).rejects.toThrow(ForbiddenException);
    expect(trackService.assertCallerMayMakeGlobal).toHaveBeenCalledWith(true);
    expect(trackService.createTrack).not.toHaveBeenCalled();
  });

  it("checks a media file is not another course's before deleting it", async () => {
    const url = 'https://b.s3.r.amazonaws.com/track-media/image/x.png';

    await expect(controller.deleteMedia({ url })).rejects.toThrow(
      ForbiddenException,
    );
    expect(trackService.assertCallerMayDeleteMedia).toHaveBeenCalledWith(url);
    expect(trackMediaService.deleteMedia).not.toHaveBeenCalled();
  });
});
