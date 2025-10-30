import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('groups')
export class Group {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;
}
