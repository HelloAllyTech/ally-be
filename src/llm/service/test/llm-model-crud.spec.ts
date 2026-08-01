import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { LlmModelService } from '../llm-model.service';

const buildService = (overrides: Partial<Record<string, any>> = {}) => {
  const repository = {
    listModels: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((row: any) => row),
    save: jest.fn((row: any) => Promise.resolve({ id: 'new-id', ...row })),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    ...overrides,
  };
  return { service: new LlmModelService(repository as any), repository };
};

describe('LlmModelService — catalog editing', () => {
  describe('createModel', () => {
    it('stores a model under a provider a runtime can execute', async () => {
      const { service, repository } = buildService();

      await service.createModel({
        provider: 'openai',
        model: 'gpt-5.1-mini',
        label: 'GPT-5.1 mini',
      });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-5.1-mini',
          label: 'GPT-5.1 mini',
          supportsTemperature: true,
          active: true,
        }),
      );
    });

    // The boundary the whole catalog-in-DB decision rests on: a provider with
    // no code branch would build a silently wrong client at runtime.
    it('refuses a provider no runtime can execute, and says why', async () => {
      const { service } = buildService();

      await expect(
        service.createModel({ provider: 'cohere', model: 'command-r' }),
      ).rejects.toThrow(/Adding a provider is a code change/);
      await expect(
        service.createModel({ provider: 'cohere', model: 'command-r' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('normalises provider case and trims the model', async () => {
      const { service, repository } = buildService();

      await service.createModel({ provider: '  OpenAI ', model: '  gpt-4o  ' });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openai', model: 'gpt-4o' }),
      );
    });

    it('falls back to the model id when no label is given', async () => {
      const { service, repository } = buildService();

      await service.createModel({
        provider: 'openai',
        model: 'gpt-4o',
        label: '   ',
      });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'gpt-4o' }),
      );
    });

    it('rejects an empty model id', async () => {
      const { service } = buildService();

      await expect(
        service.createModel({ provider: 'openai', model: '   ' }),
      ).rejects.toThrow(/Model id is required/);
    });

    it('rejects a duplicate provider+model', async () => {
      const { service } = buildService({
        findOne: jest.fn().mockResolvedValue({ id: 'existing' }),
      });

      await expect(
        service.createModel({ provider: 'openai', model: 'gpt-4o' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateModel', () => {
    const existing = {
      id: 'm1',
      provider: 'openai',
      model: 'gpt-4o',
      label: 'GPT-4o',
      supportsTemperature: true,
      active: true,
    };

    it('404s on a model that does not exist', async () => {
      const { service } = buildService({
        findOne: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.updateModel('nope', { active: false }),
      ).rejects.toThrow(NotFoundException);
    });

    it('keeps untouched fields as they were', async () => {
      const { service, repository } = buildService({
        findOne: jest.fn().mockResolvedValue({ ...existing }),
      });

      await service.updateModel('m1', { active: false });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4o',
          label: 'GPT-4o',
          active: false,
        }),
      );
    });

    it('lets supportsTemperature be corrected to false', async () => {
      const { service, repository } = buildService({
        findOne: jest.fn().mockResolvedValue({ ...existing }),
      });

      await service.updateModel('m1', { supportsTemperature: false });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ supportsTemperature: false }),
      );
    });

    it('still refuses an unrunnable provider on update', async () => {
      const { service } = buildService({
        findOne: jest.fn().mockResolvedValue({ ...existing }),
      });

      await expect(
        service.updateModel('m1', { provider: 'cohere' }),
      ).rejects.toThrow(BadRequestException);
    });

    // Renaming onto another row's provider+model would violate the unique index
    // at the DB level; catch it with a readable message first.
    it('rejects a rename that collides with another row', async () => {
      const findOne = jest
        .fn()
        .mockResolvedValueOnce({ ...existing })
        .mockResolvedValueOnce({
          id: 'other',
          provider: 'openai',
          model: 'gpt-4.1',
        });
      const { service } = buildService({ findOne });

      await expect(
        service.updateModel('m1', { model: 'gpt-4.1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows saving a row without changing its own key', async () => {
      const findOne = jest.fn().mockResolvedValue({ ...existing });
      const { service, repository } = buildService({ findOne });

      await service.updateModel('m1', { label: 'GPT-4o (legacy)' });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'GPT-4o (legacy)' }),
      );
    });
  });

  describe('deleteModel', () => {
    it('deletes an existing row', async () => {
      const { service } = buildService();
      await expect(service.deleteModel('m1')).resolves.toEqual({
        deleted: true,
      });
    });

    it('404s when nothing was removed', async () => {
      const { service } = buildService({
        delete: jest.fn().mockResolvedValue({ affected: 0 }),
      });
      await expect(service.deleteModel('m1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getCatalog', () => {
    // The pickers' feed hides inactive rows and falls back to the in-code list;
    // an editor must see exactly what is stored.
    it('includes inactive rows and does not fall back', async () => {
      const listModels = jest.fn().mockResolvedValue([]);
      const { service } = buildService({ listModels });

      await expect(service.getCatalog()).resolves.toEqual([]);
      expect(listModels).toHaveBeenCalledWith(false);
    });
  });
});
