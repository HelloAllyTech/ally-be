import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../common/entity/base.entity';
import { DashboardMetadata } from '../type/dashboard.data.type';

//TODO: Remove this entity by 10 March 2026
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
  data?: DashboardMetadata;
}
