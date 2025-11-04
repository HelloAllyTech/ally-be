import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { BaseEntity } from '../../common/entity/base.entity';

@Entity('feedback')
export class Feedback extends BaseEntity {
  @PrimaryGeneratedColumn()
  feedbackId!: number;

  @Column({ nullable: true })
  modifiedContent?: string;

  @Column({ type: 'float', nullable: true })
  rating?: number;

  @Index('message_id_index')
  @Column()
  messageId!: number;

  @Index('user_id_index')
  @Column()
  userId!: number;
}
