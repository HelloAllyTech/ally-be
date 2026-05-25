import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('rating_metadata')
export class RatingMetadata {
  @PrimaryColumn({ type: 'int' })
  rating!: number;

  @Column()
  ratingText!: string;

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  tags!: string[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
