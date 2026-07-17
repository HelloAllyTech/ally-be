import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { LabEvaluatorService } from '../lab-evaluator.service';
import { LabEvaluatorRepository } from '../../repository/lab-evaluator.repository';
import { LabRunAssignmentRepository } from '../../repository/lab-eval.repositories';
import { AppConfigService } from 'src/config/config.service';
import { EmailService } from 'src/notification/service/email.service';
import { EVALUATOR_TOKEN_KIND } from '../../constants/lab-eval.constants';

describe('LabEvaluatorService', () => {
  let service: LabEvaluatorService;
  let evaluatorRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock };
  let emailService: { sendEvaluatorInvite: jest.Mock };

  beforeEach(async () => {
    evaluatorRepository = {
      findOne: jest.fn(),
      save: jest.fn(async (e) => ({ id: 'ev1', ...e })),
      create: jest.fn((e) => e),
    };
    jwtService = { signAsync: jest.fn().mockResolvedValue('signed-token') };
    emailService = { sendEvaluatorInvite: jest.fn().mockResolvedValue(true) };

    const configService = {
      jwt: { accessToken: { secret: 'secret' } },
    } as unknown as AppConfigService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LabEvaluatorService,
        { provide: LabEvaluatorRepository, useValue: evaluatorRepository },
        {
          provide: LabRunAssignmentRepository,
          useValue: { createQueryBuilder: jest.fn() },
        },
        { provide: JwtService, useValue: jwtService },
        { provide: AppConfigService, useValue: configService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = module.get<LabEvaluatorService>(LabEvaluatorService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('emails the new evaluator their portal invite with the generated password', async () => {
      const { password } = await service.create({ email: 'Eval@X.com' });
      expect(emailService.sendEvaluatorInvite).toHaveBeenCalledWith({
        to: 'eval@x.com',
        password,
      });
    });
  });

  describe('login', () => {
    // rounds=4 keeps the test fast; the service compares regardless of cost.
    const makeEvaluator = (password: string) => ({
      id: 'ev1',
      email: 'eval@x.com',
      passwordHash: bcrypt.hashSync(password, 4),
      tokenVersion: 2,
      createdAt: new Date(),
      lastLoginAt: null,
    });

    it('issues an evaluator-kind token with the current tokenVersion on valid credentials', async () => {
      evaluatorRepository.findOne.mockResolvedValue(makeEvaluator('hunter2'));

      const result = await service.login({
        email: 'Eval@x.com',
        password: 'hunter2',
      });

      expect(result.accessToken).toBe('signed-token');
      const payload = jwtService.signAsync.mock.calls[0][0];
      expect(payload).toMatchObject({
        sub: 'ev1',
        kind: EVALUATOR_TOKEN_KIND,
        tv: 2,
      });
    });

    it('rejects a wrong password', async () => {
      evaluatorRepository.findOne.mockResolvedValue(makeEvaluator('hunter2'));
      await expect(
        service.login({ email: 'eval@x.com', password: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects (and still runs a compare for) an unknown email', async () => {
      evaluatorRepository.findOne.mockResolvedValue(null);
      const compareSpy = jest.spyOn(bcrypt, 'compare');
      await expect(
        service.login({ email: 'nobody@x.com', password: 'whatever' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      // Timing-equalizer: a compare runs even when the email is unknown.
      expect(compareSpy).toHaveBeenCalled();
    });
  });

  describe('validateToken', () => {
    it('accepts a matching kind + tokenVersion', async () => {
      evaluatorRepository.findOne.mockResolvedValue({
        id: 'ev1',
        tokenVersion: 5,
      });
      const ev = await service.validateToken({
        sub: 'ev1',
        kind: EVALUATOR_TOKEN_KIND,
        tv: 5,
      });
      expect(ev.id).toBe('ev1');
    });

    it('rejects a non-evaluator kind', async () => {
      await expect(
        service.validateToken({ sub: 'ev1', kind: 'user', tv: 5 }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a stale tokenVersion (revoked by password regeneration)', async () => {
      evaluatorRepository.findOne.mockResolvedValue({
        id: 'ev1',
        tokenVersion: 6,
      });
      await expect(
        service.validateToken({
          sub: 'ev1',
          kind: EVALUATOR_TOKEN_KIND,
          tv: 5,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
