import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LabEvalQuestion } from '../entity/lab-eval-question.entity';
import { LabRunAssignment } from '../entity/lab-run-assignment.entity';
import { LabEvalAnswer } from '../entity/lab-eval-answer.entity';

@Injectable()
export class LabEvalQuestionRepository extends Repository<LabEvalQuestion> {
  constructor(private readonly dataSource: DataSource) {
    super(LabEvalQuestion, dataSource.createEntityManager());
  }
}

@Injectable()
export class LabRunAssignmentRepository extends Repository<LabRunAssignment> {
  constructor(private readonly dataSource: DataSource) {
    super(LabRunAssignment, dataSource.createEntityManager());
  }
}

@Injectable()
export class LabEvalAnswerRepository extends Repository<LabEvalAnswer> {
  constructor(private readonly dataSource: DataSource) {
    super(LabEvalAnswer, dataSource.createEntityManager());
  }
}
