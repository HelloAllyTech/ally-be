import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AgentTestCaseType } from '../enum/agent-test-case.enum';

/** One scoring row of a full-session test case. */
export interface AgentTestCaseRubric {
  criteria: string;
  scoringInstructions: string;
}

@Entity('agent_test_cases')
export class AgentTestCase extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  title!: string;

  @Column({ enum: AgentTestCaseType, default: AgentTestCaseType.CONDITION })
  type!: AgentTestCaseType;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  tags!: string[];

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  // --- Condition test cases only ---
  /** The condition to simulate. */
  @Column({ type: 'text', nullable: true })
  condition?: string | null;

  /** Test pass description (what makes the agent pass this condition). */
  @Column({ type: 'text', nullable: true })
  test?: string | null;

  // --- Full-session test cases only ---
  /** Ordered list of {criteria, scoringInstructions} rows. */
  @Column({ type: 'jsonb', nullable: true })
  rubrics?: AgentTestCaseRubric[] | null;

  @Column({ nullable: true })
  createdBy?: number;
}
