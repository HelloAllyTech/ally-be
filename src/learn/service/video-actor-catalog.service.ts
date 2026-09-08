import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { S3Service } from 'src/aws/service/s3.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  VideoActorProvider,
  VIDEO_ACTOR_PROVIDER_LABELS,
} from '../enum/video-actor-provider.enum';

/** One selectable vendor. */
export interface VideoActorProviderEntry {
  /** Written into `scenarios.metadata.videoActorProvider`. */
  value: string;
  /** What the picker shows. */
  label: string;
}

/**
 * One selectable face, normalised across vendors.
 *
 * The whole point of this shape is that the client renders a picker without
 * knowing which vendor it is looking at. Tavus calls a face a "replica" and
 * publishes two thumbnails; Beyond Presence calls it an "avatar" and publishes
 * none. Neither of those words, and no vendor-specific field, reaches ally-web
 * — a consumer branches on whether `thumbnailImageUrl` is present, never on
 * `provider`. Adding a third vendor is then a change in this file only.
 */
export interface VideoActorFaceEntry {
  /** Written into `scenarios.metadata.videoActorAvatarId`. */
  value: string;
  /** What the picker shows. */
  label: string;
  /**
   * Which vendor this face belongs to, written into
   * `scenarios.metadata.videoActorProvider` alongside the id.
   *
   * Carried per face so an author picks a *face* and the vendor follows, rather
   * than picking a vendor first and then being shown a roster. The client
   * stores this value back verbatim and never interprets it — it is an opaque
   * token here, not a branch.
   */
  provider: string;
  /**
   * A still of this face, where the vendor publishes one.
   *
   * Absent — not a placeholder — when it does not. Beyond Presence returns only
   * id/name/status/visibility from `GET /v1/avatar`, and the per-avatar detail
   * endpoint returns the same four fields, so there is genuinely no preview
   * media to serve for bey. A client must therefore treat `undefined` as "show
   * the name alone", never as a broken image.
   */
  thumbnailImageUrl?: string;
  /** A short talking clip, where the vendor publishes one. Tavus only. */
  thumbnailVideoUrl?: string;
  /**
   * A pre-formatted vendor note for the picker's secondary line — Tavus's
   * model name, for instance. Composed here rather than shipped as structured
   * vendor fields precisely so the client never has to interpret one.
   */
  detail?: string;
}

/** Tavus replica as returned by `GET /v2/replicas`. */
interface TavusReplica {
  replica_id?: string;
  replica_name?: string;
  model_name?: string;
  status?: string;
  thumbnail_image_url?: string;
  thumbnail_video_url?: string;
}

/** Beyond Presence avatar as returned by `GET /v1/avatar`. */
interface BeyAvatar {
  id?: string;
  name?: string;
  status?: string;
  visibility?: string;
}

/**
 * A vendor face's still, copied into our own storage.
 *
 * Image only. The vendors' talking clips run to 54 MB — a third of the Tavus
 * roster is over the 15 MB the cover-video uploader allows — and pulling those
 * through the API to re-encode them is a lot of machinery for a cover video an
 * author can upload themselves. Cover video is left entirely alone by this
 * path.
 *
 * The URLs are ours, not the vendor's. A cover image is long-lived
 * learner-facing content and the vendor's CDN paths are account-scoped
 * (`cdn.replica.tavus.io/<account>/thumbnail.jpg`), so pointing a roleplay card
 * at one would make it break silently whenever the vendor rotates or expires
 * it. Copying costs one fetch at authoring time and nothing afterwards.
 */
export interface VideoActorCoverMedia {
  coverImageUrl?: string;
}

const TAVUS_API_URL = 'https://tavusapi.com/v2';
const BEY_API_URL = 'https://api.bey.dev/v1';

/**
 * Page cap on the Beyond Presence roster walk.
 *
 * Their list endpoint is paginated 10 at a time and reports `has_more` with a
 * `next_cursor`. This runs inside a request an author is waiting on, so the
 * walk is bounded rather than trusting a vendor to terminate it: 20 pages is
 * 200 faces, far more than a picker can usefully show, and each page is
 * additionally bounded by CATALOG_TIMEOUT_MS.
 */
const BEY_MAX_PAGES = 20;

/**
 * How long to wait on a vendor before giving up.
 *
 * This serves an author staring at a picker in Studio, so a slow vendor must
 * become an empty list and a log line rather than a spinner that never
 * resolves.
 */
const CATALOG_TIMEOUT_MS = 10_000;

/**
 * Faces are only selectable if the worker could render them, and a `phoenix-4`
 * Tavus replica cannot: it is accepted by the API, joins the LiveKit room and
 * then publishes no track at all, which reaches the learner as a session with
 * no voice and no picture. Offering one in a picker would be offering a broken
 * roleplay, so they are filtered out here rather than warned about downstream.
 */
const TAVUS_SUPPORTED_MODEL = 'phoenix-3';

/**
 * Where imported face covers land, alongside hand-uploaded ones.
 *
 * Under a `video-actor/` prefix and keyed DETERMINISTICALLY by provider + face
 * id — no timestamp. A face's preview media never changes, so the same face
 * always resolves to the same object: re-picking it costs one HEAD instead of
 * re-downloading tens of megabytes from the vendor and leaving another copy
 * behind. The first version timestamped every key and accumulated four copies
 * of one face inside a few minutes of editing.
 */
const COVER_IMAGE_FOLDER = 'scenario-cover-images/video-actor';

/**
 * Caps on what we will copy out of a vendor.
 *
 * Matches the limits an author is held to when uploading a cover by hand (2 MB
 * image), so an imported cover cannot be something the UI would have rejected.
 * The video allowance is larger because these are short talking clips, but it
 * is still bounded — this fetches a third party's URL into our bucket, and an
 * unbounded read there is a memory footgun in a request handler.
 */
const MAX_COVER_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * Content types a vendor CDN may serve media as.
 *
 * Tavus serves its mp4 thumbnails as `binary/octet-stream`, so a strict
 * `video/*` check rejected every cover video — the still copied, the clip did
 * not, and the roleplay was left showing the PREVIOUS face's video. Octet
 * stream is accepted only when the URL's extension says what the bytes are.
 */
const OPAQUE_CONTENT_TYPES = [
  'binary/octet-stream',
  'application/octet-stream',
];

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

/**
 * How long a fetched roster stays reusable.
 *
 * Validating one face id used to re-fetch all ~98 replicas on the click path,
 * and a single 10s timeout there turned into "that face is not selectable" —
 * blaming the author's input for a vendor timeout. A vendor's roster does not
 * change within an editing session, so it is cached for a minute and the
 * validation almost always answers from memory.
 */
const ROSTER_CACHE_MS = 60_000;

@Injectable()
export class VideoActorCatalogService {
  private readonly rosterCache = new Map<
    string,
    { at: number; faces: VideoActorFaceEntry[] }
  >();

  // Static instance rather than DI, matching TtsCatalogService: LoggerService
  // is not a provider in LearnModule, and injecting it takes the whole module's
  // DI graph down at boot.
  private readonly logger = LoggerService.getInstance(
    VideoActorCatalogService.name,
  );

  constructor(
    private readonly configService: AppConfigService,
    private readonly s3Service: S3Service,
  ) {}

  /** Every vendor a roleplay may be pointed at. Static: see the enum. */
  getProviders(): VideoActorProviderEntry[] {
    return Object.values(VideoActorProvider).map((value) => ({
      value,
      label: VIDEO_ACTOR_PROVIDER_LABELS[value],
    }));
  }

  /**
   * The faces this vendor can render, newest-usable-first as the vendor orders
   * them.
   *
   * Returns an empty array rather than throwing when the vendor is unreachable
   * or unconfigured: an author with no faces listed can still save a roleplay
   * and type an id, whereas a 500 here blocks the whole Studio panel.
   */
  async getFaces(provider: string): Promise<VideoActorFaceEntry[]> {
    const normalised = (provider ?? '').trim().toLowerCase();
    if (
      !Object.values(VideoActorProvider).includes(
        normalised as VideoActorProvider,
      )
    ) {
      throw new BadRequestException(
        `Unknown video actor provider "${provider}". Expected one of: ${Object.values(
          VideoActorProvider,
        ).join(', ')}`,
      );
    }

    const cached = this.rosterCache.get(normalised);
    if (cached && Date.now() - cached.at < ROSTER_CACHE_MS) {
      return cached.faces;
    }

    try {
      const faces =
        normalised === VideoActorProvider.TAVUS
          ? await this.fetchTavusFaces()
          : await this.fetchBeyFaces();
      this.rosterCache.set(normalised, { at: Date.now(), faces });
      return faces;
    } catch (error) {
      this.logger.error(
        `[VIDEO_ACTOR_CATALOG] failed to list ${normalised} faces: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      // A stale roster beats no roster: the picker stays usable through a
      // vendor blip, and the ids in it were valid a minute ago.
      if (cached) return cached.faces;
      throw error;
    }
  }

  /** The roster, or an empty list — for the picker, which must always render. */
  private async getFacesOrEmpty(
    provider: string,
  ): Promise<VideoActorFaceEntry[]> {
    try {
      return await this.getFaces(provider);
    } catch {
      return [];
    }
  }

  private async fetchTavusFaces(): Promise<VideoActorFaceEntry[]> {
    const apiKey = this.configService.videoActorCatalog.tavusApiKey;
    if (!apiKey) {
      this.logger.warn(
        '[VIDEO_ACTOR_CATALOG] no Tavus key configured (VIDEO_ACTOR_TAVUS_API_KEY, else VIDEO_ACTOR_API_KEY) — returning no faces',
      );
      return [];
    }

    const body = await this.getJson(`${TAVUS_API_URL}/replicas?limit=100`, {
      'x-api-key': apiKey,
    });
    const replicas: TavusReplica[] = body?.data ?? [];

    return replicas
      .filter(
        (replica) =>
          !!replica.replica_id &&
          replica.status === 'completed' &&
          replica.model_name === TAVUS_SUPPORTED_MODEL,
      )
      .map((replica) => ({
        value: replica.replica_id as string,
        label: replica.replica_name || (replica.replica_id as string),
        provider: VideoActorProvider.TAVUS as string,
        thumbnailImageUrl: replica.thumbnail_image_url || undefined,
        thumbnailVideoUrl: replica.thumbnail_video_url || undefined,
        detail: replica.model_name || undefined,
      }));
  }

  private async fetchBeyFaces(): Promise<VideoActorFaceEntry[]> {
    const apiKey = this.configService.videoActorCatalog.beyApiKey;
    if (!apiKey) {
      this.logger.warn(
        '[VIDEO_ACTOR_CATALOG] no Beyond Presence key configured (VIDEO_ACTOR_BEY_API_KEY, else VIDEO_ACTOR_API_KEY) — returning no faces',
      );
      return [];
    }

    // PAGINATED, 10 to a page. Reading only the first page hid 11 of our 21
    // avatars from the picker — including bey's own default face ("Ege",
    // b9be11b8-...), which an author could therefore never select even though
    // it renders perfectly. So follow `next_cursor` until `has_more` is false.
    const avatars: BeyAvatar[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < BEY_MAX_PAGES; page += 1) {
      const url = cursor
        ? `${BEY_API_URL}/avatar?cursor=${encodeURIComponent(cursor)}`
        : `${BEY_API_URL}/avatar`;
      const body = await this.getJson(url, { 'x-api-key': apiKey });
      // bey has returned both a bare array and a `{ data: [...] }` envelope
      // from this path; accept either rather than depending on which one
      // today's deployment answers with. A bare array carries no cursor, so
      // it is necessarily the whole roster.
      if (Array.isArray(body)) {
        avatars.push(...body);
        break;
      }
      avatars.push(...(body?.data ?? []));
      if (!body?.has_more || !body?.next_cursor) {
        break;
      }
      cursor = body.next_cursor as string;
    }

    return avatars
      .filter((avatar) => !!avatar.id && avatar.status === 'available')
      .map((avatar) => ({
        value: avatar.id as string,
        label: avatar.name || (avatar.id as string),
        provider: VideoActorProvider.BEY as string,
        // No thumbnail keys: bey publishes no preview media. Left absent so the
        // client shows the name alone rather than a broken image.
        detail: undefined,
      }));
  }

  /**
   * Every selectable face across every vendor, as one list.
   *
   * This is what the picker actually renders: an author chooses a face, and the
   * vendor is derived from it. Asking them to pick a vendor first is asking a
   * question they have no basis to answer — the meaningful difference is which
   * face suits the character, not whose API renders it.
   *
   * One slow or broken vendor must not empty the whole roster, so failures are
   * per-vendor and already swallowed by `getFaces`.
   */
  async getAllFaces(): Promise<VideoActorFaceEntry[]> {
    const perVendor = await Promise.all(
      Object.values(VideoActorProvider).map((provider) =>
        this.getFacesOrEmpty(provider),
      ),
    );
    // Faces that can be previewed sort first: a roster whose visible half is
    // name-only rows reads as broken, and Beyond Presence publishes no preview
    // media at all.
    return perVendor
      .flat()
      .sort(
        (a, b) =>
          Number(!!b.thumbnailImageUrl) - Number(!!a.thumbnailImageUrl) ||
          a.label.localeCompare(b.label),
      );
  }

  /**
   * Copy one face's preview media into our own storage, for use as a cover.
   *
   * Returns only what the vendor actually publishes: Beyond Presence publishes
   * nothing, so this resolves to an empty object for bey rather than failing —
   * the caller's cover simply stays as it was.
   *
   * Best-effort per asset. A thumbnail that is too large, unreachable or of an
   * unexpected type is skipped with a log line rather than failing the whole
   * import, because a missing cover video must not cost the author the cover
   * image that did copy successfully.
   */
  async importFaceCover(
    provider: string,
    faceId: string,
  ): Promise<VideoActorCoverMedia> {
    // Throws rather than returning [] when the vendor is unreachable, so an
    // outage cannot masquerade as an invalid face id.
    let faces: VideoActorFaceEntry[];
    try {
      faces = await this.getFaces(provider);
    } catch {
      // Deliberately not surfacing the vendor's own message: this is an
      // authoring action, and "could not reach the vendor" is the whole of
      // what an author can act on.
      throw new ServiceUnavailableException(
        `Could not reach ${provider} to confirm that face. Nothing was changed — try again in a moment.`,
      );
    }

    const face = faces.find((candidate) => candidate.value === faceId);
    if (!face) {
      // Still validated against the live roster rather than trusting the
      // client: this endpoint makes the server fetch a URL, and that URL must
      // come from the vendor, never from the request.
      throw new BadRequestException(
        `Face "${faceId}" is not one of the selectable faces for provider "${provider}".`,
      );
    }

    const bucket = this.configService.s3.learnMediaPublicBucket;
    if (!bucket) {
      throw new Error(
        'S3 bucket name for learnMediaPublicBucket is not defined',
      );
    }

    const coverImageUrl = await this.copyToStorage({
      bucket,
      sourceUrl: face.thumbnailImageUrl,
      folder: COVER_IMAGE_FOLDER,
      fileName: `${provider}-${faceId}`,
      maxBytes: MAX_COVER_IMAGE_BYTES,
      expectedType: 'image/',
    });

    return { coverImageUrl };
  }

  private async copyToStorage(params: {
    bucket: string;
    sourceUrl?: string;
    folder: string;
    fileName: string;
    maxBytes: number;
    expectedType: string;
  }): Promise<string | undefined> {
    const { bucket, sourceUrl, folder, fileName, maxBytes, expectedType } =
      params;
    if (!sourceUrl) return undefined;

    try {
      // The extension comes from the vendor's URL, which is stable, so the
      // storage key can be computed BEFORE fetching anything.
      const urlExtension =
        new URL(sourceUrl).pathname.split('.').pop()?.toLowerCase() ?? '';
      const key = `${folder}/${fileName}.${urlExtension || 'bin'}`;

      // Already imported? Then this is a no-op — the whole point of a
      // deterministic key.
      const existing = await this.s3Service
        .getHeadObject({ bucket, key })
        .catch(() => null);
      if (existing) {
        return this.publicUrlFor(bucket, key);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(sourceUrl, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const served = (response.headers.get('content-type') ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      const byExtension = EXTENSION_CONTENT_TYPES[urlExtension];

      // Trust the served type when it is specific; fall back to the URL's
      // extension when the CDN is vague. A vendor handing back an error page
      // instead of media must still be rejected, or it gets stored as a cover
      // and renders as a broken tile for every learner.
      const contentType = OPAQUE_CONTENT_TYPES.includes(served)
        ? byExtension
        : served;
      if (!contentType || !contentType.startsWith(expectedType)) {
        throw new Error(
          `unexpected content-type "${served}" for .${urlExtension || '?'} (wanted ${expectedType}*)`,
        );
      }

      const body = Buffer.from(await response.arrayBuffer());
      if (body.byteLength > maxBytes) {
        throw new Error(
          `${body.byteLength} bytes exceeds the ${maxBytes}-byte cap`,
        );
      }

      await this.s3Service.uploadStream({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Safe to cache forever BECAUSE the key is write-once: it is derived
        // from provider + face id, and the HEAD check above means an existing
        // object is never overwritten. So a browser's cached copy can never
        // disagree with what is stored — the failure mode of a stable URL whose
        // bytes change underneath it cannot arise here.
        //
        // The trade is deliberate: if a vendor ever re-shoots a face, we keep
        // the still we already have. For a roleplay's cover that is the better
        // outcome — an author's cover image should not change under them
        // because a vendor updated their catalogue.
        CacheControl: 'public, max-age=31536000, immutable',
      });

      return this.publicUrlFor(bucket, key);
    } catch (error) {
      this.logger.warn(
        `[VIDEO_ACTOR_CATALOG] could not copy ${expectedType}* cover from ${sourceUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  /**
   * A URL for a stored object that the AUTHOR'S BROWSER can actually load.
   *
   * The virtual-hosted amazonaws.com form is right in a deployment and wrong
   * locally, where the bytes live in LocalStack: the object uploads fine and the
   * cover tile then renders "Image not available", because the URL points at
   * real S3. `AWS_S3_PRESIGN_ENDPOINT_URL` already exists for exactly this —
   * a browser-reachable S3 endpoint (`http://localhost:4566` locally) — so when
   * it is set the URL is built path-style against it, which is what LocalStack
   * serves.
   *
   * The hand-upload path sidesteps this with a mock-URL escape hatch
   * (`isMockScenarioCoverImageUpload`). That is no use here: the point of this
   * feature is that the cover really is the chosen face, so a placeholder image
   * would hide whether the import worked at all.
   */
  private publicUrlFor(bucket: string, key: string): string {
    const browserEndpoint = process.env.AWS_S3_PRESIGN_ENDPOINT_URL;
    if (browserEndpoint) {
      return `${browserEndpoint.replace(/\/$/, '')}/${bucket}/${key}`;
    }
    const region = this.configService.aws.region;
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  private async getJson(
    url: string,
    headers: Record<string, string>,
  ): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} from ${url}: ${(await response.text()).slice(
            0,
            200,
          )}`,
        );
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
}
