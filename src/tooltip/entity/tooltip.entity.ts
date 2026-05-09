import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('tooltips')
export class Tooltip {
  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('uq_tooltips_location_idx', { unique: true })
  @Column()
  location!: string;

  @Column('text')
  tipText!: string;

  @Column({ type: 'text', nullable: true })
  icon?: string | null;

  @Column({ default: false })
  active!: boolean;

  @Column()
  createdBy!: number;

  @Column()
  updatedBy!: number;
}
