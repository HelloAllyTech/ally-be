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

  /**
   * Locks the row, reads its pre-update balance and applies the same clamping
   * deduction as before, all in one round trip: the `FOR UPDATE` CTE is
   * materialized once, so the balance returned here and the one the `CASE`
   * deducts from are guaranteed to be the same snapshot — no second query, and
   * no race with a concurrent deduction for the same user.
   *
   * Returns null when the user has no credits row (nothing to update), rather
   * than throwing, so the caller keeps its existing "not found" handling.
   */
  async consumeCredits(
    userId: number,
    creditsToConsume: number,
  ): Promise<{ creditLimit: number; consumedCreditsBefore: number } | null> {
    const rows: Array<{ creditLimit: number; consumedCreditsBefore: number }> =
      await this.query(
        `
        WITH old AS (
          SELECT "creditLimit", "consumedCredits"
          FROM simulation_credits
          WHERE "userId" = $1
          FOR UPDATE
        )
        UPDATE simulation_credits sc
        SET "consumedCredits" = CASE
            WHEN old."creditLimit" >= old."consumedCredits" + $2
            THEN old."consumedCredits" + $2
            ELSE old."creditLimit"
          END
        FROM old
        WHERE sc."userId" = $1
        RETURNING old."creditLimit" AS "creditLimit",
                  old."consumedCredits" AS "consumedCreditsBefore"
        `,
        [userId, creditsToConsume],
      );

    return rows[0] ?? null;
  }
}
