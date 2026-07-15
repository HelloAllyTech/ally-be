import { AssignmentStatus } from 'src/common/type/common.type';
import { SortOrder } from 'src/scenario-path/type/scenario-paths.type';
import { CreateCaseItemDto } from '../dto/create-case-item.dto';
import { CreateCaseDto } from '../dto/create-case.dto';
import { CaseSession } from '../entity/case-session.entity';
import { Case } from '../entity/case.entity';

export enum CaseStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export type CaseItemData = CreateCaseItemDto & {
  id?: string;
};

export type CaseData = Omit<CreateCaseDto, 'scenarios'> & {
  id?: string;
  scenarios?: CaseItemData[];
};

export interface MinimalCaseData {
  id: string;
  title: string;
  description?: string;
  coverImageUrl?: string;
  status: CaseStatus;
}

export enum CaseSortBy {
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
}

export interface CaseFilterOptions {
  status?: string[];
  limit?: number;
  offset?: number;
  search?: string;
  tenantId?: string;
  assignmentStatus?: AssignmentStatus;
  sortBy?: CaseSortBy;
  order?: SortOrder;
}

export interface CaseWithSessionFilterOptions {
  userId: number;
  tenantId: string;
  limit?: number;
  offset?: number;
  sortBy?: CaseSortBy;
  order?: SortOrder;
  status: CaseStatus;
}

export interface CaseWithSession extends Case {
  session: CaseSession;
}

export interface CasesWithSession {
  data: CaseWithSession[];
  count: number;
}

export interface CaseTranslations {
  title?: string;
  description?: string;
}
