import { convertDropboxLink } from '../../shared/dropboxLink.ts';

/**
 * Converts a Dropbox share link into a direct playback URL and, when asked,
 * checks that the file is actually reachable and is a video.
 */
export default async function (req) {
  try {
    const body = await req.json().catch(() => ({}));
    const link = typeof body.link === 'string' ? body.link : '';
    const test = body.test === true;

    if (!link.trim()) {
      return Response.json({ ok: false, error: 'Paste a Dropbox link' }, { status: 400 });
    }

    const converted = convertDropboxLink(link);
    if (!converted.ok) {
      return Response.json({ ok: false, error: converted.error }, { status: 200 });
    }

    if (!test) {
      return Response.json({ ok: true, url: converted.url });
    }

    let res;
    try {
      res = await fetch(converted.url, {
        method: 'GET',
        headers: { Range: 'bytes=0-2047' },
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
      });
    } catch (err) {
      return Response.json({
        ok: false,
        error: 'Could not reach Dropbox. Check the link and try again.',
      });
    }

    if (res.status === 404 || res.status === 410) {
      return Response.json({ ok: false, error: 'That link is expired or the file was removed.' });
    }
    if (res.status === 403 || res.status === 401) {
      return Response.json({ ok: false, error: 'Dropbox refused access. Make sure the file is shared with anyone who has the link.' });
    }
    if (!res.ok && res.status !== 206) {
      return Response.json({ ok: false, error: `Dropbox returned an error (${res.status}).` });
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const isVideo =
      contentType.startsWith('video/') ||
      contentType === 'application/octet-stream' ||
      contentType === 'application/vnd.apple.mpegurl';

    if (contentType.includes('text/html')) {
      return Response.json({
        ok: false,
        error: 'That link opens a Dropbox page, not a video file. Copy the file share link instead.',
      });
    }
    if (!isVideo) {
      return Response.json({ ok: false, error: `That file is not a playable video (${contentType || 'unknown type'}).` });
    }

    const sizeHeader = res.headers.get('content-range') || '';
    const total = Number(sizeHeader.split('/')[1]) || 0;

    return Response.json({ ok: true, url: converted.url, contentType, size: total });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}