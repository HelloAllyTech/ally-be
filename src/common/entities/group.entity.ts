import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

@Entity('groups')
export class Group extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  group!: string;
}
