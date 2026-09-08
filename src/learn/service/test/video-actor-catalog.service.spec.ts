import { VideoActorCatalogService } from '../video-actor-catalog.service';

/**
 * Beyond Presence's avatar list is PAGINATED, 10 to a page, reporting
 * `has_more` with a `next_cursor`. The first version of this service read only
 * the first page, which silently hid 11 of our 21 faces from the Studio picker
 * — including bey's own default face ("Ege"), so an author could never select a
 * face that renders perfectly well. A truncated roster looks identical to a
 * short one, which is why this is pinned by a test rather than left to a code
 * comment.
 */
describe('VideoActorCatalogService — Beyond Presence roster', () => {
  let service: VideoActorCatalogService;
  let fetchMock: jest.Mock;

  const configService = {
    videoActorCatalog: { beyApiKey: 'bey-key', tavusApiKey: undefined },
  };

  const page = (
    rows: Array<Record<string, unknown>>,
    next?: string,
  ): Record<string, unknown> => ({
    data: rows,
    has_more: !!next,
    next_cursor: next,
  });

  const face = (id: string, name: string, status = 'available') => ({
    id,
    name,
    status,
    visibility: 'public',
  });

  const ok = (body: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    service = new VideoActorCatalogService(configService as any, {} as any);
  });

  it('follows next_cursor to the end of the roster', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(page([face('a', 'Nelly')], 'cur-1')))
      .mockResolvedValueOnce(ok(page([face('b', 'Ege')], 'cur-2')))
      .mockResolvedValueOnce(ok(page([face('c', 'Zaid')])));

    const faces = await service.getFaces('bey');

    expect(faces.map((f) => f.value)).toEqual(['a', 'b', 'c']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('sends the cursor the previous page handed back', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(page([face('a', 'Nelly')], 'cur-1')))
      .mockResolvedValueOnce(ok(page([face('b', 'Ege')])));

    await service.getFaces('bey');

    expect(fetchMock.mock.calls[0][0]).not.toContain('cursor=');
    expect(fetchMock.mock.calls[1][0]).toContain('cursor=cur-1');
  });

  it('url-encodes a cursor', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(page([face('a', 'Nelly')], 'a b&c=d')))
      .mockResolvedValueOnce(ok(page([face('b', 'Ege')])));

    await service.getFaces('bey');

    expect(fetchMock.mock.calls[1][0]).toContain('cursor=a%20b%26c%3Dd');
  });

  it('stops when has_more is true but no cursor came back', async () => {
    // Defensive: a cursor-less has_more would otherwise re-request page one
    // forever, inside a request an author is waiting on.
    fetchMock.mockResolvedValue(
      ok({ data: [face('a', 'Nelly')], has_more: true }),
    );

    const faces = await service.getFaces('bey');

    expect(faces).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caps the walk rather than trusting the vendor to terminate it', async () => {
    fetchMock.mockResolvedValue(ok(page([face('a', 'Nelly')], 'never-ending')));

    await service.getFaces('bey');

    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it('still accepts a bare array, which carries no cursor', async () => {
    fetchMock.mockResolvedValueOnce(ok([face('a', 'Nelly'), face('b', 'Ege')]));

    const faces = await service.getFaces('bey');

    expect(faces.map((f) => f.value)).toEqual(['a', 'b']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('drops unavailable faces from every page, not just the first', async () => {
    // The real roster has one 'failed' avatar, and it is not on page one.
    fetchMock
      .mockResolvedValueOnce(ok(page([face('a', 'Nelly')], 'cur-1')))
      .mockResolvedValueOnce(ok(page([face('b', 'Onder', 'failed')])));

    const faces = await service.getFaces('bey');

    expect(faces.map((f) => f.value)).toEqual(['a']);
  });

  it('never returns a half-walked roster when a later page fails', async () => {
    // Page one succeeded, so a naive implementation would hand back one face
    // and cache it as the whole roster for a minute. Better to fail: a short
    // roster is indistinguishable from a truncated one, and the author would
    // conclude the face they wanted does not exist.
    fetchMock
      .mockResolvedValueOnce(ok(page([face('a', 'Nelly')], 'cur-1')))
      .mockRejectedValueOnce(new Error('bey down'));

    await expect(service.getFaces('bey')).rejects.toThrow('bey down');
    // Nothing cached, so the next caller retries rather than being served a
    // truncated list.
    fetchMock.mockResolvedValueOnce(ok(page([face('a', 'Nelly')])));
    await expect(service.getFaces('bey')).resolves.toHaveLength(1);
  });

  it('leaves the picker renderable when the vendor is down', async () => {
    // getFaces rethrows so the endpoint can say something went wrong; the
    // merged roster the picker renders swallows it per-vendor instead, so one
    // broken vendor cannot empty the whole list.
    fetchMock.mockRejectedValue(new Error('bey down'));

    await expect(service.getAllFaces()).resolves.toEqual([]);
  });
});
