import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IsNotEmpty, IsString, Length } from 'class-validator';

@Entity('places')
export class Place {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index('idx_city')
  @Column()
  @IsNotEmpty()
  @IsString()
  @Length(1, 100)
  city!: string;

  @Column()
  @IsNotEmpty()
  @IsString()
  @Length(1, 100)
  state!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
