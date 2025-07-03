import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { DashboardData } from './type/dashboard.data.type';

@Entity()
export class Dashboard extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  externalId!: string;

  @Column()
  name!: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  order?: number;

  @Column()
  groupId!: string;

  @Column({ nullable: true, type: 'jsonb' })
  data?: DashboardData;
}
