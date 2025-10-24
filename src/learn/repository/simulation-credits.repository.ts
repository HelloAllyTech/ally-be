import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { SimulationCredits } from 'src/learn/entity/simulation-credits.entity';

@Injectable()
export class SimulationCreditsRepository extends Repository<SimulationCredits> {
  constructor(private dataSource: DataSource) {
    super(SimulationCredits, dataSource.createEntityManager());
  }

  async findByUserId(userId: number): Promise<SimulationCredits | null> {
    return this.findOne({
      where: { userId },
    });
  }

  async createOrUpdate(
    userId: number,
    credits: number,
  ): Promise<SimulationCredits> {
    const existing = await this.findByUserId(userId);

    if (existing) {
      existing.creditLimit = credits;
      return this.save(existing);
    } else {
      const newCredits = this.create({
        userId,
        creditLimit: credits,
        consumedCredits: 0,
      });
      return this.save(newCredits);
    }
  }

  async consumeCredits(
    userId: number,
    creditsToConsume: number,
  ): Promise<boolean> {
    const result = await this.createQueryBuilder()
      .update(SimulationCredits)
      .set({
        consumedCredits: () => `
          CASE 
            WHEN "creditLimit" >= "consumedCredits" + :creditsToConsume 
            THEN "consumedCredits" + :creditsToConsume
            ELSE "creditLimit"
          END
        `,
      })
      .where('userId = :userId', { userId })
      .setParameter('creditsToConsume', creditsToConsume)
      .execute();

    return result.affected !== 0;
  }
}
