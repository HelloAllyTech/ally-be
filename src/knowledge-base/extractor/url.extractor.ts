import { BadRequestException } from '@nestjs/common';
import axios from 'axios';
import {
  KB_URL_FETCH_TIMEOUT_MS,
  KB_URL_MAX_BYTES,
} from '../constants/knowledge-base.constants';
import { ExtractedDocument } from './extracted-document.type';
import { htmlToExtractedDocument } from './html.util';

/**
 * Fetch a public URL and extract its main text.
 *
 * Uses the shared sanitize-html walk rather than @mozilla/readability + jsdom. Readability picks
 * main content more cleanly, but it requires a full DOM, and jsdom is a large dependency tree to
 * add to the API image for one admin ingest path. The approved plan explicitly allowed this
 * trade: accept messier text, keep the image small. The boilerplate that survives (nav, footer)
 * costs some retrieval precision but cannot produce a WRONG answer — it just makes a few chunks
 * less useful, and an admin can see and delete them.
 *
 * Only http(s) is accepted, and redirects are capped. A corpus ingest that follows an arbitrary
 * scheme or an unbounded redirect chain is an SSRF surface, and this endpoint is reachable by an
 * admin who is pasting URLs from the internet.
 */
export async function extractUrl(url: string): Promise<ExtractedDocument> {
  const parsed = safeParseUrl(url);

  let html: string;
  let contentType: string;
  try {
    const response = await axios.get<string>(parsed.toString(), {
      timeout: KB_URL_FETCH_TIMEOUT_MS,
      maxContentLength: KB_URL_MAX_BYTES,
      maxBodyLength: KB_URL_MAX_BYTES,
      maxRedirects: 5,
      responseType: 'text',
      // Some publishers serve a JS-only shell to unknown agents; identifying honestly is the
      // right trade, and a page we cannot read is reported rather than silently half-ingested.
      headers: { Accept: 'text/html,application/xhtml+xml' },
      // Treat only 2xx as usable: a 404's error page would otherwise be ingested as content.
      validateStatus: (status: number) => status >= 200 && status < 300,
    });
    html = response.data;
    contentType = String(response.headers['content-type'] ?? '');
  } catch (error) {
    const reason =
      axios.isAxiosError(error) && error.response
        ? `HTTP ${error.response.status}`
        : error instanceof Error
          ? error.message
          : 'unknown error';
    throw new BadRequestException(
      `Could not fetch that URL (${reason}). Check that it is publicly reachable.`,
    );
  }

  if (contentType && !/html|xml|text\/plain/i.test(contentType)) {
    // A PDF served at a URL is a real case, but it must be uploaded as a PDF so it goes through
    // the page-aware extractor — silently treating its bytes as HTML would produce garbage text.
    throw new BadRequestException(
      `That URL returned ${contentType}, which cannot be read as a web page. If it is a PDF, ` +
        `download it and upload it as a PDF so page numbers are preserved.`,
    );
  }

  const extracted = htmlToExtractedDocument(html);
  if (!extracted.text.trim()) {
    throw new BadRequestException(
      'No readable text was found at that URL — the page is most likely rendered by ' +
        'JavaScript. Copy the text and add it as a pasted document instead.',
    );
  }

  return { ...extracted, language: extracted.language ?? htmlLang(html) };
}

function safeParseUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException('That is not a valid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('Only http and https URLs can be ingested.');
  }
  return parsed;
}

function htmlLang(html: string): string | undefined {
  const match = /<html[^>]*\slang=["']([a-zA-Z-]{2,10})["']/i.exec(html);
  return match?.[1];
}
