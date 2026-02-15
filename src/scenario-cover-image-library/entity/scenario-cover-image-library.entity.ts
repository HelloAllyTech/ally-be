import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('scenario_cover_image_library')
export class ScenarioCoverImageLibrary extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', name: 'image_url' })
  imageUrl!: string;

  @Column({ name: 'created_by', type: 'int' })
  createdBy!: number;
}
