import { Column, Entity, PrimaryColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from '../../common/entities/base-without-tenant.entity';

@Entity('session_events')
export class SessionEvents extends BaseWithoutTenantEntity {
  @PrimaryColumn({ type: 'varchar' })
  id!: string;

  @Column()
  name!: string;

  @Column()
  description!: string;

  @Column()
  score!: number;

  @Column()
  emoji!: string;

  @Column()
  message!: string;

  @Column({ nullable: true })
  branchInstruction?: string;
}
