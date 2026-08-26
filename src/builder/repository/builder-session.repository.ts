import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { BuilderSession } from '../entity/builder-session.entity';

@Injectable()
export class BuilderSessionRepository extends Repository<BuilderSession> {
  constructor(private readonly dataSource: DataSource) {
    super(BuilderSession, dataSource.createEntityManager());
  }

  /**
   * True when the slug is already taken. Checked against soft-deleted rows
   * too: the branch those sessions pushed still exists on the remote, so
   * reusing the name would push onto someone else's history.
   */
  async slugExists(slug: string): Promise<boolean> {
    const count = await this.count({ where: { slug }, withDeleted: true });
    return count > 0;
  }
}
