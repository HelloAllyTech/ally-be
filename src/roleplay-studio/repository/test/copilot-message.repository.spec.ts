import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CopilotMessageRepository } from '../copilot-message.repository';
import { CopilotMessageRole } from '../../enum/copilot-message-role.enum';

/**
 * Regression coverage for appendMessage's handling of EntityManager.query()'s
 * return shape. On Postgres a RETURNING UPDATE comes back as a
 * `[rows, affectedCount]` tuple, not a bare rows array — misreading it made
 * every append throw session_not_found even when the UPDATE matched a row.
 */
describe('CopilotMessageRepository.appendMessage', () => {
  let repository: CopilotMessageRepository;
  let queryMock: jest.Mock;
  let saveMock: jest.Mock;

  const sessionId = '8231bdb4-7b89-4b7f-89c6-4648dbb64fa6';
  const message = {
    role: CopilotMessageRole.USER,
    content: 'hello',
    createdBy: 1,
  };

  const buildRepo = (queryResult: unknown) => {
    queryMock = jest.fn().mockResolvedValue(queryResult);
    saveMock = jest
      .fn()
      .mockImplementation((entity) => Promise.resolve(entity));
    const em = {
      query: queryMock,
      getRepository: jest.fn().mockReturnValue({
        create: jest.fn().mockImplementation((entity) => entity),
        save: saveMock,
      }),
    };
    const mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue({}),
      transaction: jest.fn().mockImplementation((cb) => cb(em)),
    } as unknown as DataSource;
    return new CopilotMessageRepository(mockDataSource);
  };

  it('unwraps the [rows, affectedCount] tuple and appends with the returned seq', async () => {
    repository = buildRepo([[{ lastMessageSeq: 5 }], 1]);

    const saved = await repository.appendMessage(sessionId, message);

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saved).toMatchObject({ sessionId, seq: 5, content: 'hello' });
  });

  it('also handles a bare rows array (driver/version variance)', async () => {
    repository = buildRepo([{ lastMessageSeq: 7 }]);

    const saved = await repository.appendMessage(sessionId, message);

    expect(saved).toMatchObject({ sessionId, seq: 7 });
  });

  it('throws NotFoundException with the id when the UPDATE matched no rows', async () => {
    repository = buildRepo([[], 0]);

    await expect(repository.appendMessage(sessionId, message)).rejects.toThrow(
      new NotFoundException(`Copilot session not found: ${sessionId}`),
    );
    expect(saveMock).not.toHaveBeenCalled();
  });
});
