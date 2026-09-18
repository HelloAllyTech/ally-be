import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { BuilderPrdDoc } from '../entity/builder-prd-doc.entity';
import { BuilderPrdVersion } from '../entity/builder-prd-version.entity';

@Injectable()
export class BuilderPrdDocRepository extends Repository<BuilderPrdDoc> {
  constructor(dataSource: DataSource) {
    super(BuilderPrdDoc, dataSource.createEntityManager());
  }

  findBySession(sessionId: string): Promise<BuilderPrdDoc | null> {
    return this.findOne({ where: { sessionId } });
  }
}

@Injectable()
export class BuilderPrdVersionRepository extends Repository<BuilderPrdVersion> {
  constructor(dataSource: DataSource) {
    super(BuilderPrdVersion, dataSource.createEntityManager());
  }

  /** Newest first — the version list is read backwards from "now". */
  listByDoc(docId: string): Promise<BuilderPrdVersion[]> {
    return this.find({ where: { docId }, order: { versionNumber: 'DESC' } });
  }
}
