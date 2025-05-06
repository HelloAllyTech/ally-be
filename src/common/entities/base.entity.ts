import { CreateDateColumn, UpdateDateColumn, Column } from 'typeorm';

export class BaseEntity {
  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ name: 'tenant_id', default: 'default' })
  tenantId!: string;
}
