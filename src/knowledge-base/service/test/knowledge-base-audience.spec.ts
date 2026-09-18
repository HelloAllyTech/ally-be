import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AiService } from '../../../ai/service/ai.service';
import { S3Service } from '../../../aws/service/s3.service';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { AppConfigService } from '../../../config/config.service';
import { Tenant } from '../../../tenant/entity/tenant.entity';
import { KbDocument } from '../../entity/kb-document.entity';
import { KbIngestProducer } from '../../producer/kb-ingest.producer';
import { KbDocumentChunkRepository } from '../../repository/kb-document-chunk.repository';
import { KbDocumentTenantRepository } from '../../repository/kb-document-tenant.repository';
import { KbDocumentRepository } from '../../repository/kb-document.repository';
import { KbRetrievalRepository } from '../../repository/kb-retrieval.repository';
import { KnowledgeBaseService } from '../knowledge-base.service';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: jest.fn(),
    getTenantId: jest.fn(),
    getExecutionId: jest.fn(),
  },
}));

const DOC_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

/**
 * Targeting a document at organisations.
 *
 * The failures worth pinning are all silent ones. A document whose Postgres rows say one thing
 * and whose vectors say another answers the wrong people while both screens look right; an
 * organisation id that does not exist looks correctly targeted and retrieves nothing; and a
 * no-op save that sweeps every chunk of a 300-page book costs minutes for nothing.
 */
describe('KnowledgeBaseService audience', () => {
  let service: KnowledgeBaseService;
  let documentRepository: { findOne: jest.Mock; update: jest.Mock };
  let documentTenantRepository: {
    replaceForDocument: jest.Mock;
    tenantIdsForDocument: jest.Mock;
    tenantIdsByDocument: jest.Mock;
  };
  let aiService: { setKnowledgeChunkAudience: jest.Mock };
  let tenantRepository: { count: jest.Mock };

  const document = (over: Partial<KbDocument> = {}): KbDocument =>
    ({
      id: DOC_ID,
      title: 'Managing Suicidal Ideation',
      isGlobal: false,
      tags: [],
      status: 'indexed',
      chunkCount: 12,
      indexedChunkCount: 12,
      chunkVersion: 1,
      ...over,
    }) as unknown as KbDocument;

  beforeEach(async () => {
    (ExecutionManager.getUserId as jest.Mock).mockReturnValue(42);

    documentRepository = {
      findOne: jest.fn().mockResolvedValue(document()),
      update: jest.fn().mockResolvedValue(undefined),
    };
    documentTenantRepository = {
      replaceForDocument: jest
        .fn()
        .mockResolvedValue({ added: [], removed: [], tenantIds: [] }),
      tenantIdsForDocument: jest.fn().mockResolvedValue([]),
      tenantIdsByDocument: jest.fn().mockResolvedValue(new Map()),
    };
    aiService = {
      setKnowledgeChunkAudience: jest
        .fn()
        .mockResolvedValue({ document_id: DOC_ID, updated: 12 }),
    };
    tenantRepository = { count: jest.fn().mockResolvedValue(1) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeBaseService,
        { provide: KbDocumentRepository, useValue: documentRepository },
        { provide: KbDocumentChunkRepository, useValue: {} },
        {
          provide: KbDocumentTenantRepository,
          useValue: documentTenantRepository,
        },
        { provide: KbIngestProducer, useValue: { enqueue: jest.fn() } },
        { provide: AiService, useValue: aiService },
        { provide: S3Service, useValue: {} },
        { provide: AppConfigService, useValue: { s3: {} } },
        // The retrieval log, which the audience paths never write — a retarget changes who may
        // be answered, it does not retrieve.
        { provide: KbRetrievalRepository, useValue: { record: jest.fn() } },
        { provide: getRepositoryToken(Tenant), useValue: tenantRepository },
      ],
    }).compile();

    service = module.get(KnowledgeBaseService);
  });

  it('targets a document at specific organisations and pushes that to the index', async () => {
    tenantRepository.count.mockResolvedValue(2);
    documentTenantRepository.replaceForDocument.mockResolvedValue({
      added: [TENANT_A, TENANT_B],
      removed: [],
      tenantIds: [TENANT_A, TENANT_B],
    });

    const result = await service.setAudience(DOC_ID, {
      isGlobal: false,
      tenantIds: [TENANT_A, TENANT_B],
    });

    expect(result.isGlobal).toBe(false);
    expect(result.tenantIds).toEqual([TENANT_A, TENANT_B]);
    expect(aiService.setKnowledgeChunkAudience).toHaveBeenCalledWith(DOC_ID, {
      is_global: false,
      tenant_ids: [TENANT_A, TENANT_B],
    });
  });

  it('clears the organisations when a document is made global', async () => {
    // Stale ids would be harmless while isGlobal stayed true and wrong the moment it was turned
    // off again — the document would silently come back for organisations already removed.
    await service.setAudience(DOC_ID, {
      isGlobal: true,
      tenantIds: [TENANT_A],
    });

    expect(documentTenantRepository.replaceForDocument).toHaveBeenCalledWith(
      DOC_ID,
      [],
    );
    expect(aiService.setKnowledgeChunkAudience).toHaveBeenCalledWith(DOC_ID, {
      is_global: true,
      tenant_ids: [],
    });
  });

  it('rejects an organisation that does not exist before writing anything', async () => {
    // The ids reach a Weaviate filter, where a nonexistent one is indistinguishable from a real
    // one that never matches: the document would look correctly targeted and answer nobody.
    tenantRepository.count.mockResolvedValue(0);

    await expect(
      service.setAudience(DOC_ID, {
        isGlobal: false,
        tenantIds: [TENANT_A],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(documentTenantRepository.replaceForDocument).not.toHaveBeenCalled();
    expect(aiService.setKnowledgeChunkAudience).not.toHaveBeenCalled();
  });

  it('does not sweep the index when nothing changed', async () => {
    documentTenantRepository.replaceForDocument.mockResolvedValue({
      added: [],
      removed: [],
      tenantIds: [TENANT_A],
    });

    await service.setAudience(DOC_ID, {
      isGlobal: false,
      tenantIds: [TENANT_A],
    });

    expect(aiService.setKnowledgeChunkAudience).not.toHaveBeenCalled();
  });

  it('reports an index failure rather than showing the change as saved', async () => {
    // The half-applied state is the dangerous one: passages still answering for an organisation
    // the admin just removed, on a screen that said it worked.
    documentTenantRepository.replaceForDocument.mockResolvedValue({
      added: [],
      removed: [TENANT_A],
      tenantIds: [],
    });
    aiService.setKnowledgeChunkAudience.mockRejectedValue(
      new Error('weaviate is down'),
    );

    await expect(
      service.setAudience(DOC_ID, { isGlobal: false, tenantIds: [] }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('retargets an archived document without touching the index', async () => {
    // Archiving deleted its vectors, so there is nothing to sweep — but the assignment is
    // recorded and waiting for whenever it is unarchived and re-indexed.
    documentRepository.findOne.mockResolvedValue(
      document({ archivedAt: new Date() }),
    );
    documentTenantRepository.replaceForDocument.mockResolvedValue({
      added: [TENANT_A],
      removed: [],
      tenantIds: [TENANT_A],
    });

    const result = await service.setAudience(DOC_ID, {
      isGlobal: false,
      tenantIds: [TENANT_A],
    });

    expect(result.tenantIds).toEqual([TENANT_A]);
  });

  it('reports a global document as having no organisations', async () => {
    // Rows may exist from before it was made global. Returning them would invite a UI that
    // renders a document available to everyone as if it were restricted to three customers.
    documentRepository.findOne.mockResolvedValue(document({ isGlobal: true }));
    documentTenantRepository.tenantIdsForDocument.mockResolvedValue([TENANT_A]);

    const result = await service.get(DOC_ID);

    expect(result.isGlobal).toBe(true);
    expect(result.tenantIds).toEqual([]);
  });
});
