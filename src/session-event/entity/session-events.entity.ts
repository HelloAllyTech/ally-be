import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from '../../common/entities/base-without-tenant.entity';

@Entity('session_events')
export class SessionEvents extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn()
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
