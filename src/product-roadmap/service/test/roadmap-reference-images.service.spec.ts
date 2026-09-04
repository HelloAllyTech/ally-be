import { UnprocessableEntityException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Repository } from 'typeorm';

import { User } from 'src/user/entity/user.entity';
import { BugFinding } from 'src/bug-hunter/entity/bug-finding.entity';
import { S3Service } from 'src/aws/service/s3.service';

import { RoadmapOpportunityService } from '../roadmap-opportunity.service';
import { RoadmapOpportunityRepository } from '../../repository/roadmap-opportunity.repository';
import { RoadmapVectorService } from '../roadmap-vector.service';
import { RoadmapNotificationService } from '../roadmap-notification.service';
import {
  CreateOpportunityDto,
  UpdateOpportunityDto,
} from '../../dto/roadmap-opportunity.dto';
import {
  ROADMAP_LIMITS,
  ROADMAP_REFERENCE_IMAGE_MAX_SIZE_BYTES,
  ROADMAP_REFERENCE_IMAGE_S3_PREFIX,
} from '../../constants/product-roadmap.constants';

const OPP_ID = '11111111-1111-1111-1111-111111111111';
const BUCKET = 'ally-assets';
const OURS = `https://${BUCKET}.s3.ap-south-1.amazonaws.com/${ROADMAP_REFERENCE_IMAGE_S3_PREFIX}/1700000000000-shot.png`;

/**
 * Reference images on an opportunity.
 *
 * The bulk of this suite is about ONE rule: only objects this service issued a presigned URL for
 * may be stored. The array is rendered as `<img src>` in the admin dashboard for every roadmap
 * viewer, so an unchecked URL is a way for one filer to point every reader's browser wherever
 * they like — which makes the guard a security boundary rather than tidiness, and worth a test
 * per way around it.
 */
describe('RoadmapOpportunityService — reference images', () => {
  const build = () => {
    const opportunityRepository = {
      create: jest.fn().mockImplementation((row) => row),
      save: jest.fn().mockResolvedValue({ id: OPP_ID, type: 'idea' }),
      update: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue({ id: OPP_ID, stage: 'new' }),
      findOneWithScore: jest.fn().mockResolvedValue({
        id: OPP_ID,
        createdBy: 1,
        description: 'x',
        productGoal: 'Scribe',
        type: 'idea',
        referenceImages: [{ url: OURS }],
      }),
    };

    // The real parser, not a stub: half of what this suite checks is which URL SHAPES resolve to
    // our bucket, and a stubbed parser would let the guard pass on strings S3Service rejects.
    const s3Service = {
      parseS3Url: new S3Service({
        aws: { region: 'ap-south-1' },
      } as never).parseS3Url,
      getPresignedUrlForImageUpload: jest
        .fn()
        .mockResolvedValue({ presignedUrl: 'https://signed', imageUrl: OURS }),
    };

    const service = new RoadmapOpportunityService(
      opportunityRepository as unknown as RoadmapOpportunityRepository,
      {} as never, // allocationRepository — unused by these tests
      {
        countGoals: jest.fn().mockResolvedValue(0),
        getRankContext: jest.fn().mockResolvedValue({
          weights: {
            votesWeight: 1,
            votersWeight: 1,
            effortWeight: 1,
            goalImpactWeight: 1,
          },
          bases: { maxScore: 0, maxVoters: 0, totalGoals: 0 },
        }),
      } as never,
      { assessQuietly: jest.fn().mockResolvedValue(undefined) } as never,
      {
        indexQuietly: jest.fn().mockResolvedValue(undefined),
      } as unknown as RoadmapVectorService,
      { emit: jest.fn() } as unknown as RoadmapNotificationService,
      { find: jest.fn().mockResolvedValue([]) } as unknown as Repository<User>,
      {
        create: jest.fn(),
        save: jest.fn(),
      } as unknown as Repository<BugFinding>,
      s3Service as unknown as S3Service,
      { s3: { assetsBucket: BUCKET } } as never,
      // Never consulted here: the readiness gate applies only to the /opportunities
      // create call, which passes enforceReadiness. A throwing stub keeps that true.
      {
        verify: jest.fn(() => {
          throw new Error(
            'readiness token verified on a path that should not gate',
          );
        }),
      } as never,
    );

    return { service, opportunityRepository, s3Service };
  };

  const fileDto = (
    referenceImages?: CreateOpportunityDto['referenceImages'],
  ): CreateOpportunityDto =>
    ({
      description: 'As a trainer, the filter row wraps below 1200px',
      productGoal: 'Scribe',
      referenceImages,
    }) as CreateOpportunityDto;

  it('stores an image uploaded through the roadmap', async () => {
    const { service, opportunityRepository } = build();

    await service.create(1, fileDto([{ url: OURS, caption: 'Current state' }]));

    expect(opportunityRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceImages: [{ url: OURS, caption: 'Current state' }],
      }),
    );
  });

  it('files an opportunity with no images as an empty array, not null', async () => {
    // "No images" has ONE representation. A null here would make every reader handle both, and
    // the column is NOT NULL, so the alternative is a 500 on the insert.
    const { service, opportunityRepository } = build();

    await service.create(1, fileDto());

    expect(opportunityRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ referenceImages: [] }),
    );
  });

  it('drops a blank caption rather than storing whitespace', async () => {
    const { service, opportunityRepository } = build();

    await service.create(1, fileDto([{ url: OURS, caption: '   ' }]));

    expect(opportunityRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ referenceImages: [{ url: OURS }] }),
    );
  });

  it.each([
    ['a third-party host', 'https://evil.example.com/tracker.png'],
    [
      'another bucket',
      `https://other-bucket.s3.ap-south-1.amazonaws.com/${ROADMAP_REFERENCE_IMAGE_S3_PREFIX}/x.png`,
    ],
    [
      'another feature’s prefix in our bucket',
      `https://${BUCKET}.s3.ap-south-1.amazonaws.com/blog/x.png`,
    ],
    [
      'a prefix that merely starts the same way',
      `https://${BUCKET}.s3.ap-south-1.amazonaws.com/${ROADMAP_REFERENCE_IMAGE_S3_PREFIX}-public/x.png`,
    ],
  ])('refuses %s', async (_label, url) => {
    const { service, opportunityRepository } = build();

    await expect(service.create(1, fileDto([{ url }]))).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(opportunityRepository.create).not.toHaveBeenCalled();
  });

  it('applies the same guard on update, so edit is not a way around create', async () => {
    const { service, opportunityRepository } = build();

    await expect(
      service.update(1, OPP_ID, {
        referenceImages: [{ url: 'https://evil.example.com/tracker.png' }],
      } as UpdateOpportunityDto),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(opportunityRepository.update).not.toHaveBeenCalled();
  });

  it('treats [] on update as a real edit that clears the images', async () => {
    const { service, opportunityRepository } = build();

    await service.update(1, OPP_ID, {
      referenceImages: [],
    } as UpdateOpportunityDto);

    expect(opportunityRepository.update).toHaveBeenCalledWith(
      OPP_ID,
      expect.objectContaining({ referenceImages: [] }),
    );
  });

  it('leaves the images alone when the patch does not mention them', async () => {
    // The drawer PATCHes on a debounce with whatever fields it holds; an unrelated edit must not
    // be able to wipe attachments it never showed the user.
    const { service, opportunityRepository } = build();

    await service.update(1, OPP_ID, {
      description: 'reworded',
    } as UpdateOpportunityDto);

    const [, patch] = opportunityRepository.update.mock.calls[0];
    expect(patch).not.toHaveProperty('referenceImages');
  });

  it('always answers with an array, even for a row stored before the column existed', async () => {
    const { service, opportunityRepository } = build();
    opportunityRepository.findOneWithScore.mockResolvedValue({
      id: OPP_ID,
      createdBy: 1,
      description: 'x',
      productGoal: 'Scribe',
      type: 'idea',
    });

    await expect(service.findOne(1, OPP_ID)).resolves.toEqual(
      expect.objectContaining({ referenceImages: [] }),
    );
  });

  it('presigns into the roadmap prefix, under the roadmap size cap', async () => {
    const { service, s3Service } = build();

    await expect(
      service.createReferenceImageUploadUrl({
        fileName: 'shot.png',
        fileSize: 1024,
        contentType: 'image/png' as never,
      }),
    ).resolves.toEqual({ presignedUrl: 'https://signed', imageUrl: OURS });

    expect(s3Service.getPresignedUrlForImageUpload).toHaveBeenCalledWith(
      BUCKET,
      ROADMAP_REFERENCE_IMAGE_S3_PREFIX,
      'shot.png',
      1024,
      'image/png',
      ROADMAP_REFERENCE_IMAGE_MAX_SIZE_BYTES,
    );
  });
});

/**
 * The DTO's own bounds. These are the friendly-400 half of the pair whose other half is
 * CHK_roadmap_opportunities_reference_images — keep the two in step.
 */
describe('reference image DTO validation', () => {
  const errorsFor = (referenceImages: unknown) =>
    validateSync(
      plainToInstance(CreateOpportunityDto, {
        description: 'x',
        productGoal: 'Scribe',
        referenceImages,
      }),
    );

  it(`rejects more than ${ROADMAP_LIMITS.REFERENCE_IMAGES_MAX} images`, () => {
    const tooMany = Array.from(
      { length: ROADMAP_LIMITS.REFERENCE_IMAGES_MAX + 1 },
      () => ({ url: OURS }),
    );
    expect(errorsFor(tooMany)).not.toHaveLength(0);
    expect(
      errorsFor(tooMany.slice(0, ROADMAP_LIMITS.REFERENCE_IMAGES_MAX)),
    ).toHaveLength(0);
  });

  it('rejects an over-long caption', () => {
    expect(
      errorsFor([
        {
          url: OURS,
          caption: 'x'.repeat(ROADMAP_LIMITS.REFERENCE_IMAGE_CAPTION_MAX + 1),
        },
      ]),
    ).not.toHaveLength(0);
  });

  it('rejects an entry that is not a URL at all', () => {
    expect(errorsFor([{ url: 'not a url' }])).not.toHaveLength(0);
  });

  it('accepts an omitted array — filing without images is normal', () => {
    expect(errorsFor(undefined)).toHaveLength(0);
  });
});
