import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { BadgeUser } from '../entity/badge-user.entity';

@Injectable()
export class BadgeUserRepository extends Repository<BadgeUser> {
  constructor(private dataSource: DataSource) {
    super(BadgeUser, dataSource.createEntityManager());
  }
}
