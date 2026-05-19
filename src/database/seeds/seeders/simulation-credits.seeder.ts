import { DataSource } from 'typeorm';
import { SimulationCredits } from '../../../learn/entity/simulation-credits.entity';
import { User } from '../../../user/entity/user.entity';
import { getRepo, log, upsert } from '../helpers';
import {
  simulationCreditsByEmail,
  simulationCreditsDefault,
} from '../fixtures';

export async function seedSimulationCredits(ds: DataSource): Promise<void> {
  const userRepo = getRepo(ds, User);
  const creditsRepo = getRepo(ds, SimulationCredits);

  const users = await userRepo.find();

  let touched = 0;
  for (const user of users) {
    const override = simulationCreditsByEmail[user.email];
    const { creditLimit, consumedCredits } =
      override ?? simulationCreditsDefault;

    await upsert(
      creditsRepo,
      { userId: user.id },
      { creditLimit, consumedCredits },
    );
    touched++;
  }

  log(`simulation credits: ${touched} user(s) seeded`);
}
