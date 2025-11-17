import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { BaseEntity } from '../../common/entity/base.entity';
import { CloudTelephonyProvider } from '../../common/constants/chat.constants';
import { IntegrationStatus } from '../../audio-ingest/type/cloud-telephony.type';

@Entity('cloud_telephony_integrations')
export class CloudTelephonyIntegration extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  provider!: CloudTelephonyProvider;

  @Column({ type: 'jsonb' })
  credentials!: string;

  @Column({ default: IntegrationStatus.ACTIVE })
  status!: IntegrationStatus;

  @Column({ unique: true })
  code!: string;

  @Column({ type: 'jsonb', nullable: true })
  config?: Record<string, any>;
}
