import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'track_item_progress_criteria_lock' })
export class TrackItemProgressCriteriaLock {
  @PrimaryColumn({ name: 'track_item_progress_id', type: 'uuid' })
  trackItemProgressId!: string;

  @Column({ name: 'criteria_version_id', type: 'uuid' })
  criteriaVersionId!: string;
}
