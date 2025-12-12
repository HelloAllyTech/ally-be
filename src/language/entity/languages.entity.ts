import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('languages')
export class Languages {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ type: 'text' })
  value!: string;

  @Column({ type: 'text' })
  label!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'createdat', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updatedat', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;

  @Column({ name: 'translationCode', type: 'text', default: '' })
  translationCode!: string;
}
