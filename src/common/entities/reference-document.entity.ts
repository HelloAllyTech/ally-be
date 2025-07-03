import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from './base-without-tenant.entity';

export enum DocumentUploadStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Entity('reference_documents')
export class ReferenceDocument extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  heading!: string;

  @Column()
  content!: string;

  @Column()
  category!: string;

  @Column({ type: 'text', array: true, nullable: true })
  tags?: string[];

  @Column()
  createdBy!: number;

  @Column({ default: false })
  isPublic!: boolean;

  @Column({ nullable: true })
  organizationId?: string;

  @Column({ default: false })
  isArchived!: boolean;

  @Column({ nullable: true })
  archivedAt?: Date;

  @Column()
  uploadStatus!: DocumentUploadStatus;
}
