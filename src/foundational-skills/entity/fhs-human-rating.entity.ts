import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { StoredSkillVerdict } from './foundational-skill-assessment.entity';

/**
 * One person's rating of one cut under one rubric version — the human side of
 * the judge-vs-human check (EFF-81).
 *
 * A rater reads the same window the judge read (the cut's bounds, in Roleplay
 * Logs) and ticks behaviour codes against the same rubric
 * (docs/foundational-helping-skills.md §4). Like the judge, the rater never
 * gives a level: every level in `ticks` is derived in code with the judge's
 * own `deriveLevel`, so a human 3 and a judge 3 mean exactly the same thing
 * and the comparison is of what each SAW, not of how each rounds.
 *
 * `ticks` has the judge's `verdicts` shape (`StoredSkillVerdict`): every rubric
 * skill with its opportunity, observed codes, not-applicable codes and derived
 * level — behaviour codes only, no quotes and no free text, so nothing here
 * stores learner speech. `anyUnhelpful` is the judge's
 * `hasUnhelpfulBehaviour` rule applied to the rater's ticks.
 *
 * Unique `(cutId, raterId, rubricVersion)`: a rater who submits again replaces
 * their own rating (upsert); a rubric bump starts a fresh set, and agreement
 * reads one version only. `cutId` cascades from `foundational_skill_cuts` like
 * the judge's assessments; `raterId` (users.id) has no FK, like the cuts'
 * `userId`. CHECK constraints and indexes live in migration 1975720000000 only.
 */
@Entity('fhs_human_ratings')
@Index(
  'UQ_fhs_human_ratings_cut_rater_version',
  ['cutId', 'raterId', 'rubricVersion'],
  { unique: true },
)
export class FhsHumanRating extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** `foundational_skill_cuts.id` — the window that was rated. */
  @Column({ type: 'uuid' })
  cutId!: string;

  /** `users.id` of the person who rated it. */
  @Column({ type: 'int' })
  raterId!: number;

  @Column({ type: 'varchar', length: 64 })
  rubricVersion!: string;

  /** Every rubric skill, judge `verdicts` shape, level derived in code. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  ticks!: StoredSkillVerdict[];

  /** Any assessed skill scored 1 (an unhelpful behaviour was ticked). */
  @Column({ type: 'boolean' })
  anyUnhelpful!: boolean;

  /** When the rater last submitted (an upsert moves it). */
  @Column({ type: 'timestamp' })
  ratedAt!: Date;
}
