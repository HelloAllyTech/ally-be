import { OpenAiImageProvider } from '../openai-image.provider';
import { AppConfigService } from 'src/config/config.service';

const mockGenerate = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    images: { generate: mockGenerate },
  })),
}));

const providerFor = (imageModel: string) =>
  new OpenAiImageProvider({
    openai: { apiKey: 'sk-test', imageModel },
  } as unknown as AppConfigService);

describe('OpenAiImageProvider', () => {
  beforeEach(() => {
    mockGenerate.mockReset();
    mockGenerate.mockResolvedValue({
      data: [{ b64_json: Buffer.from('png').toString('base64') }],
    });
  });

  it('passes the requested quality to a gpt-image model', async () => {
    await providerFor('gpt-image-1').generateImage('a bench', '1536x1024', {
      quality: 'medium',
    });
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-image-1', quality: 'medium' }),
    );
  });

  it('leaves quality to the model default when none is asked for', async () => {
    await providerFor('gpt-image-1').generateImage('a bench', '1536x1024');
    expect(mockGenerate.mock.calls[0][0]).not.toHaveProperty('quality');
  });

  it('never sends a gpt-image tier to a dall-e model, which would reject it', async () => {
    await providerFor('dall-e-3').generateImage('a bench', '1792x1024', {
      quality: 'medium',
    });
    expect(mockGenerate.mock.calls[0][0]).not.toHaveProperty('quality');
  });

  it('returns the decoded image bytes', async () => {
    const image = await providerFor('gpt-image-1').generateImage(
      'a bench',
      '1536x1024',
    );
    expect(image.toString()).toBe('png');
  });
});
