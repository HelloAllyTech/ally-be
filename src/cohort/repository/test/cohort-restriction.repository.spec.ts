import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import { CohortRestrictionRepository } from '../cohort-restriction.repository';
import { CohortContentType } from '../../constants/cohort.constants';

const TENANT = 'f948763c-8eeb-4def-ad74-8f3ed0e4cd39';
const CASE_ID = '53e41638-e17a-4008-aff9-0b3eda83d4f2';
const COHORT_A = '11111111-1111-1111-1111-111111111111';

describe('CohortRestrictionRepository', () => {
  let repository: CohortRestrictionRepository;
  let managerQuery: jest.Mock;
  let dataSourceManagerQuery: jest.Mock;
  let transaction: jest.Mock;

  beforeEach(async () => {
    managerQuery = jest.fn().mockResolvedValue(undefined);
    dataSourceManagerQuery = jest.fn().mockResolvedValue(undefined);
    transaction = jest.fn(async (cb: (manager: EntityManager) => unknown) =>
      cb({ query: managerQuery } as unknown as EntityManager),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CohortRestrictionRepository,
        {
          provide: DataSource,
          useValue: {
            manager: { query: dataSourceManagerQuery },
            transaction,
          },
        },
      ],
    }).compile();

    repository = module.get(CohortRestrictionRepository);
  });

  describe('replaceForContent', () => {
    it('runs the delete and the insert inside one transaction', async () => {
      await repository.replaceForContent(
        CohortContentType.CASE,
        TENANT,
        CASE_ID,
        [COHORT_A],
      );

      // Both statements must go through the SAME transactional manager, not
      // straight to dataSource.manager, otherwise a hiccup between them can
      // leave the delete committed with no insert to follow it.
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(dataSourceManagerQuery).not.toHaveBeenCalled();
      expect(managerQuery).toHaveBeenCalledTimes(2);
      expect(managerQuery.mock.calls[0][0]).toContain('DELETE FROM');
      expect(managerQuery.mock.calls[1][0]).toContain('INSERT INTO');
    });

    it('does not leave the restriction set empty when the insert fails', async () => {
      managerQuery
        .mockResolvedValueOnce(undefined) // DELETE succeeds
        .mockRejectedValueOnce(
          new Error('duplicate key value violates unique constraint'),
        );

      await expect(
        repository.replaceForContent(CohortContentType.CASE, TENANT, CASE_ID, [
          COHORT_A,
        ]),
      ).rejects.toThrow();

      // The delete and insert must live inside the same
      // dataSource.transaction() call so the failed insert rolls the delete
      // back with it, instead of leaving the content silently unrestricted.
      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('honors a manager already supplied by an enclosing transaction', async () => {
      const suppliedQuery = jest.fn().mockResolvedValue(undefined);
      const suppliedManager = {
        query: suppliedQuery,
      } as unknown as EntityManager;

      await repository.replaceForContent(
        CohortContentType.CASE,
        TENANT,
        CASE_ID,
        [COHORT_A],
        suppliedManager,
      );

      expect(transaction).not.toHaveBeenCalled();
      expect(suppliedQuery).toHaveBeenCalledTimes(2);
    });
  });
});
