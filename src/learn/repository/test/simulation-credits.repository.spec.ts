import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { SimulationCreditsRepository } from '../simulation-credits.repository';
import { SimulationCredits } from 'src/learn/entity/simulation-credits.entity';

describe('SimulationCreditsRepository', () => {
  let repository: SimulationCreditsRepository;
  let mockDataSource: any;

  const mockCredits = {
    id: 1,
    userId: 1,
    creditLimit: 100,
    consumedCredits: 25,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SimulationCredits;

  beforeEach(async () => {
    mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue({
        getRepository: jest.fn(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimulationCreditsRepository,
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    repository = module.get<SimulationCreditsRepository>(
      SimulationCreditsRepository,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findByUserId', () => {
    it('should find credits by user ID', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(mockCredits);

      const result = await repository.findByUserId(1);

      expect(result).toEqual(mockCredits);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { userId: 1 },
      });
    });

    it('should return null when no credits found', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(null);

      const result = await repository.findByUserId(1);

      expect(result).toBeNull();
    });
  });

  describe('createOrUpdate', () => {
    it('should create new credits when none exist', async () => {
      jest.spyOn(repository, 'findByUserId').mockResolvedValue(null);
      jest.spyOn(repository, 'create').mockReturnValue(mockCredits);
      jest.spyOn(repository, 'save').mockResolvedValue(mockCredits);

      const result = await repository.createOrUpdate(1, 100);

      expect(result).toEqual(mockCredits);
      expect(repository.create).toHaveBeenCalledWith({
        userId: 1,
        creditLimit: 100,
        consumedCredits: 0,
      });
    });

    it('should update existing credits', async () => {
      const existingCredits = { ...mockCredits, creditLimit: 50 };
      jest.spyOn(repository, 'findByUserId').mockResolvedValue(existingCredits);
      jest
        .spyOn(repository, 'save')
        .mockResolvedValue({ ...existingCredits, creditLimit: 100 });

      const result = await repository.createOrUpdate(1, 100);

      expect(result.creditLimit).toBe(100);
      expect(repository.save).toHaveBeenCalled();
    });
  });

  describe('consumeCredits', () => {
    it('should consume credits and return the pre-update balance', async () => {
      jest
        .spyOn(repository, 'query')
        .mockResolvedValue([{ creditLimit: 100, consumedCreditsBefore: 25 }]);

      const result = await repository.consumeCredits(1, 10);

      expect(result).toEqual({ creditLimit: 100, consumedCreditsBefore: 25 });
      expect(repository.query).toHaveBeenCalledWith(
        expect.stringContaining('FOR UPDATE'),
        [1, 10],
      );
    });

    it('should return null when no credits row exists for the user', async () => {
      jest.spyOn(repository, 'query').mockResolvedValue([]);

      const result = await repository.consumeCredits(1, 10);

      expect(result).toBeNull();
    });
  });
});
