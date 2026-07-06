import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CopilotMessageRepository } from '../copilot-message.repository';
import { CopilotSession } from '../../entity/copilot-session.entity';
import { CopilotMessageRole } from '../../enum/copilot-message-role.enum';

/**
 * Guards the seq-allocation contract in appendMessage. TypeORM 0.3's raw
 * `query()` resolves an UPDATE … RETURNING to the tuple [rows, affected], which
 * previously made the code read `rows[0].lastMessageSeq` as undefined and 404
 * the first append of every session. We now use the query builder's
 * UpdateResult (`.raw` rows + `.affected`); these tests lock that shape in.
 */
describe('CopilotMessageRepository.appendMessage', () => {
  let repo: CopilotMessageRepository;
  let updateBuilder: {
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
    returning: jest.Mock;
    execute: jest.Mock;
  };
  let messageRepo: { create: jest.Mock; save: jest.Mock };
  let transactionManager: {
    createQueryBuilder: jest.Mock;
    getRepository: jest.Mock;
  };
  let dataSource: DataSource;

  beforeEach(() => {
    updateBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn(),
    };
    messageRepo = {
      create: jest.fn().mockImplementation((row) => row),
      save: jest.fn().mockImplementation(async (row) => ({ id: 'm1', ...row })),
    };
    transactionManager = {
      createQueryBuilder: jest.fn().mockReturnValue(updateBuilder),
      getRepository: jest.fn().mockReturnValue(messageRepo),
    };
    dataSource = {
      createEntityManager: jest.fn().mockReturnValue({}),
      transaction: jest
        .fn()
        .mockImplementation(async (cb) => cb(transactionManager)),
    } as unknown as DataSource;

    repo = new CopilotMessageRepository(dataSource);
  });

  it('allocates seq from UpdateResult.raw and persists the message', async () => {
    // The query builder returns { raw, affected } — NOT the [rows, affected]
    // tuple that raw em.query() would.
    updateBuilder.execute.mockResolvedValue({
      raw: [{ lastMessageSeq: 5 }],
      affected: 1,
    });

    const saved = await repo.appendMessage('sess-1', {
      role: CopilotMessageRole.USER,
      content: 'hi',
    });

    expect(transactionManager.createQueryBuilder).toHaveBeenCalled();
    expect(updateBuilder.update).toHaveBeenCalledWith(CopilotSession);
    expect(messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-1', seq: 5, content: 'hi' }),
    );
    expect(saved.seq).toBe(5);
  });

  it('throws NotFoundException when the session row is absent (affected 0)', async () => {
    updateBuilder.execute.mockResolvedValue({ raw: [], affected: 0 });

    await expect(
      repo.appendMessage('missing', { role: CopilotMessageRole.USER }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(messageRepo.save).not.toHaveBeenCalled();
  });
});
