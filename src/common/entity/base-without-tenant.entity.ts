import { CreateDateColumn, UpdateDateColumn } from 'typeorm';

export abstract class BaseWithoutTenantEntity {
  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
