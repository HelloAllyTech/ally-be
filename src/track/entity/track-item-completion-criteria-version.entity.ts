import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TrackItemCompletionCriteria } from '../type/track.type';

@Entity({ name: 'track_item_completion_criteria_versions' })
export class TrackItemCompletionCriteriaVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'track_item_id', type: 'uuid' })
  trackItemId!: string;

  @Column({ name: 'completion_criteria', type: 'jsonb' })
  completionCriteria!: TrackItemCompletionCriteria;

  @Column({ name: 'created_by_id', type: 'integer' })
  createdById!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;
}
