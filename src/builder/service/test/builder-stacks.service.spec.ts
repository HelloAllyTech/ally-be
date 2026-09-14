import axios from 'axios';
import { BuilderStacksService } from '../builder-stacks.service';

jest.mock('axios');
const mockedPost = axios.post as jest.MockedFunction<typeof axios.post>;

/**
 * The wire format, pinned.
 *
 * This service shipped speaking a REST shape the Stacks server has never
 * exposed: it posted to `/api/mcp/search`, got Vercel's HTML app shell back
 * with a 404, found no `results` key in it and returned a confident empty
 * list. There was no test, so nothing caught it, and the interview's product
 * guidance was silently absent for the life of the feature.
 *
 * Every assertion here is a fact established by probing the live server, and
 * each one is a way the call fails silently if it regresses.
 */
describe('BuilderStacksService', () => {
  const sseReply = (text: string) =>
    `event: message\ndata: ${JSON.stringify({
      result: { content: [{ type: 'text', text }] },
      jsonrpc: '2.0',
      id: 1,
    })}\n\n`;

  const build = (
    apiUrl = 'https://stacks.example.com',
    apiKey = 'sk_stacks_x',
  ) => new BuilderStacksService({ stacks: { apiUrl, apiKey } } as never);

  beforeEach(() => jest.clearAllMocks());

  it('calls the JSON-RPC endpoint, not a REST path', async () => {
    mockedPost.mockResolvedValue({ data: sseReply('[1] A chunk') } as never);

    await build().search('empty state design patterns', 2);

    const [url, body] = mockedPost.mock.calls[0];
    expect(url).toBe('https://stacks.example.com/api/mcp');
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'search_chunks',
        arguments: { query: 'empty state design patterns', max_results: 2 },
      },
    });
  });

  /**
   * `Accept: application/json` alone is refused with a 406 naming both types.
   * It is a server requirement, not a preference.
   */
  it('accepts both JSON and the event stream', async () => {
    mockedPost.mockResolvedValue({ data: sseReply('x') } as never);

    await build().search('q');

    const config = mockedPost.mock.calls[0][2] as any;
    expect(config.headers.Accept).toBe('application/json, text/event-stream');
    expect(config.headers.Authorization).toBe('Bearer sk_stacks_x');
  });

  /**
   * The engineers' bridge names its variable `STACKS_MCP_URL` and sets it to
   * the full `/api/mcp` path. Copying that value across is the likeliest way
   * this ever gets configured, and double-appending would 404 — which reads
   * exactly like an empty library.
   */
  it('does not double-append when the URL already names the endpoint', async () => {
    mockedPost.mockResolvedValue({ data: sseReply('x') } as never);

    await build('https://stacks.example.com/api/mcp/').search('q');

    expect(mockedPost.mock.calls[0][0]).toBe(
      'https://stacks.example.com/api/mcp',
    );
  });

  it('unwraps the SSE frame and hands the model the text', async () => {
    mockedPost.mockResolvedValue({
      data: sseReply('[1] Progress Bars Drive Completion · id abc'),
    } as never);

    const result = await build().search('progress bars');

    expect(result.ok).toBe(true);
    expect(result.results).toContain('Progress Bars Drive Completion');
    expect(result.note).toContain('stacks_get');
  });

  it('parses a plain JSON reply too, if the server ever sends one', async () => {
    mockedPost.mockResolvedValue({
      data: JSON.stringify({
        result: { content: [{ type: 'text', text: 'plain' }] },
      }),
    } as never);

    expect((await build().search('q')).results).toBe('plain');
  });

  /**
   * "The library refused" and "the library was unreachable" are the same event
   * to an interview turn, and want the same sentence.
   */
  it('turns a JSON-RPC error into a soft failure', async () => {
    mockedPost.mockResolvedValue({
      data: `event: message\ndata: ${JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Not Acceptable' },
        id: null,
      })}\n\n`,
    } as never);

    const result = await build().search('q');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('stacks_search_failed');
    expect(result.note).toContain(
      'says nothing about what the library contains',
    );
  });

  it('degrades the turn when the transport fails', async () => {
    mockedPost.mockRejectedValue(new Error('ETIMEDOUT'));

    const result = await build().search('q');

    expect(result.ok).toBe(false);
    expect(result.message).toContain('ETIMEDOUT');
  });

  /**
   * The one message that must never be ambiguous: an unconfigured library is
   * not an empty one, and a model told otherwise will assert the gap to the
   * admin as fact.
   */
  it('tells the model not to claim coverage when unconfigured', async () => {
    const result = await build('', '').search('q');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('stacks_not_configured');
    expect(result.message).toContain('do NOT claim');
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('sends ids through get_chunks, capped', async () => {
    mockedPost.mockResolvedValue({ data: sseReply('body') } as never);

    const result = await build().getChunks(['a', 'b']);

    expect(mockedPost.mock.calls[0][1]).toMatchObject({
      params: { name: 'get_chunks', arguments: { ids: ['a', 'b'] } },
    });
    expect(result.chunks).toBe('body');
  });

  it('refuses an empty id list rather than calling out', async () => {
    const result = await build().getChunks([]);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('no_ids');
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
