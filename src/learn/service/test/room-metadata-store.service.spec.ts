import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppConfigService } from 'src/config/config.service';
import { LearnRoomMetadata } from '../../entity/learn-room-metadata.entity';
import { RoomMetadataStoreService } from '../room-metadata-store.service';

describe('RoomMetadataStoreService', () => {
  let service: RoomMetadataStoreService;
  let flagEnabled: boolean;
  let repo: {
    upsert: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let deleteExecute: jest.Mock;

  const fullEnvelope = {
    version: '1.0',
    tenantId: 't1',
    environment: 'test',
    scenario: { title: 'Kavya', prompt: 'x'.repeat(100) },
  };

  beforeEach(async () => {
    flagEnabled = true;
    deleteExecute = jest.fn(async () => ({ affected: 0 }));
    repo = {
      upsert: jest.fn(async () => undefined),
      findOne: jest.fn(async () => null),
      createQueryBuilder: jest.fn(() => ({
        delete: () => ({
          where: () => ({ execute: deleteExecute }),
        }),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomMetadataStoreService,
        { provide: getRepositoryToken(LearnRoomMetadata), useValue: repo },
        {
          provide: AppConfigService,
          useValue: {
            get learnMetadataFetchEnabled() {
              return flagEnabled;
            },
            api: { baseUrl: 'https://api.example/' },
          },
        },
      ],
    }).compile();

    service = module.get(RoomMetadataStoreService);
  });

  describe('LiveKit cap check', () => {
    /**
     * The check moved here from scenario-shared.service, where it measured the
     * FULL envelope. Once this class started slimming, that number stopped
     * being the room payload — so prod warned "96-144KB against a 65536 cap"
     * on every session while really setting ~223 bytes, and an investigation
     * chased it. These pin the check to what is actually being set.
     */
    const oversized = {
      version: '1.0',
      environment: 'test',
      scenario: { blob: 'x'.repeat(70 * 1024) },
    };

    it('stays quiet about the cap when the room gets the slim pointer', async () => {
      const warn = jest.spyOn((service as any).logger, 'warn');
      const error = jest.spyOn((service as any).logger, 'error');

      const out = await service.prepareRoomMetadata('ss_abc', oversized);

      // The envelope is far over the cap; what LiveKit receives is not.
      expect(
        Buffer.byteLength(JSON.stringify(out.roomPayload), 'utf8'),
      ).toBeLessThan(1024);
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });

    it('reports an over-cap room payload on the inline path', async () => {
      flagEnabled = false;
      const error = jest.spyOn((service as any).logger, 'error');

      await service.prepareRoomMetadata('ss_abc', oversized);

      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('EXCEEDS the LiveKit cap'),
      );
    });

    it('still measures the room payload when the store write fails', async () => {
      // The fallback hands LiveKit the full envelope, which is exactly when the
      // cap is a live risk and exactly when nobody is looking.
      repo.upsert.mockRejectedValueOnce(new Error('db down'));
      const error = jest.spyOn((service as any).logger, 'error');

      const out = await service.prepareRoomMetadata('ss_abc', oversized);

      expect(out.roomPayload).toBe(oversized);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('EXCEEDS the LiveKit cap'),
      );
    });
  });

  describe('prepareRoomMetadata with flag off', () => {
    it('returns the full envelope inline and stores nothing', async () => {
      flagEnabled = false;

      const out = await service.prepareRoomMetadata('ss_abc', fullEnvelope);

      expect(out.roomPayload).toBe(fullEnvelope);
      expect(out.dispatchPayload).toBe(fullEnvelope);
      expect(repo.upsert).not.toHaveBeenCalled();
    });
  });

  describe('prepareRoomMetadata with flag on', () => {
    it('persists the envelope and returns a slim fetch pointer', async () => {
      const out = await service.prepareRoomMetadata('ss_abc', fullEnvelope);

      expect(repo.upsert).toHaveBeenCalledWith(
        { roomName: 'ss_abc', payload: fullEnvelope },
        ['roomName'],
      );
      expect(out.roomPayload).toEqual({
        version: '1.0',
        // Must be carried through: the LiveKit webhook receiver filters every
        // event on room.metadata.environment (2026-07-24 outage — the slim
        // envelope silently dropped every webhook by omitting this field).
        environment: 'test',
        metadataFetch: {
          roomName: 'ss_abc',
          // Must carry the setGlobalPrefix('api') segment — the agent 404s
          // without it (2026-07-23 rollout incident).
          url: 'https://api.example/api/v1/learn/webhook/room-metadata/ss_abc',
        },
      });
      expect(out.dispatchPayload).toEqual(out.roomPayload);
      // The whole point: the dispatch payload must be tiny.
      expect(JSON.stringify(out.dispatchPayload).length).toBeLessThan(1024);
    });

    it('url-encodes the room name', async () => {
      const out = await service.prepareRoomMetadata(
        'preview-12-a b',
        fullEnvelope,
      );
      expect((out.roomPayload as any).metadataFetch.url).toContain(
        '/api/v1/learn/webhook/room-metadata/preview-12-a%20b',
      );
    });

    it('falls back to inline metadata when the store write fails', async () => {
      repo.upsert.mockRejectedValueOnce(new Error('db down'));

      const out = await service.prepareRoomMetadata('ss_abc', fullEnvelope);

      expect(out.roomPayload).toBe(fullEnvelope);
      expect(out.dispatchPayload).toBe(fullEnvelope);
    });

    it('sweeps stale rows best-effort after storing', async () => {
      await service.prepareRoomMetadata('ss_abc', fullEnvelope);
      // sweep is fire-and-forget; let the microtask run
      await new Promise(process.nextTick);
      expect(deleteExecute).toHaveBeenCalled();
    });

    it('a failing sweep does not affect the result', async () => {
      deleteExecute.mockRejectedValueOnce(new Error('sweep boom'));

      const out = await service.prepareRoomMetadata('ss_abc', fullEnvelope);
      await new Promise(process.nextTick);

      expect((out.roomPayload as any).metadataFetch).toBeDefined();
    });
  });

  describe('getRoomMetadata', () => {
    it('returns the stored payload', async () => {
      repo.findOne.mockResolvedValueOnce({
        roomName: 'ss_abc',
        payload: fullEnvelope,
      });

      await expect(service.getRoomMetadata('ss_abc')).resolves.toEqual(
        fullEnvelope,
      );
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { roomName: 'ss_abc' },
      });
    });

    it('404s for unknown/expired rooms', async () => {
      await expect(service.getRoomMetadata('ss_gone')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
