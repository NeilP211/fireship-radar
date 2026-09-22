// Reads a channel's Videos tab, the same page a browser shows at youtube.com/channel/<id>/videos.
//
// This is the primary source because the RSS feed is unreliable: on 2026-09-21 it answered 1 in
// 10 requests, while this page answered 5 in 5. It also leaves Shorts out (they live on the
// Shorts tab) and carries each video's length. What it lacks is an exact upload time, only
// "8h ago", so published is approximate here and flagged as such.
//
// The video list is embedded as JSON in `var ytInitialData = {...};`. YouTube renders each video
// as a lockupViewModel today; the older videoRenderer shape is read too in case it comes back.

const PAGE = (channelId) => `https://www.youtube.com/channel/${encodeURIComponent(channelId)}/videos`;

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  'accept-language': 'en-US,en;q=0.9',
  // Skips the "Before you continue" consent interstitial YouTube shows some regions.
  cookie: 'SOCS=CAI',
};

const SECONDS = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 };
const ALIASES = { s: 'second', sec: 'second', m: 'minute', min: 'minute', h: 'hour', hr: 'hour', d: 'day', w: 'week', wk: 'week', mo: 'month', y: 'year', yr: 'year' };

// "8h ago", "8 hours ago", "1mo ago", "Streamed 2 weeks ago" -> an ISO timestamp, or null.
export function parseAgo(text, now = new Date()) {
  const match = text?.match(/(\d+)\s*([a-z]+?)s?\s+ago\b/i);
  if (!match) return null;
  const word = match[2].toLowerCase();
  const unit = SECONDS[word] ? word : ALIASES[word];
  if (!unit) return null;
  return new Date(now.getTime() - Number(match[1]) * SECONDS[unit] * 1000).toISOString();
}

export function extractInitialData(html) {
  const match = html.match(/(?:var ytInitialData|window\["ytInitialData"\])\s*=\s*(\{.*?\});\s*<\/script>/s);
  if (!match) throw new Error('no ytInitialData on the page');
  return JSON.parse(match[1]);
}

function* walk(node, key) {
  if (!node || typeof node !== 'object') return;
  if (node[key]) {
    yield node[key];
    return;
  }
  for (const child of Object.values(node)) yield* walk(child, key);
}

const first = (node, key) => walk(node, key).next().value;

function fromLockup(lockup, now) {
  if (lockup.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO' || !lockup.contentId) return null;
  const meta = lockup.metadata?.lockupMetadataViewModel;
  const title = meta?.title?.content;
  if (!title) return null;
  const parts = [...walk(meta.metadata, 'metadataParts')].flat();
  const texts = parts.flatMap((p) => [p.text?.content, p.accessibilityLabel]).filter(Boolean);
  const badge = first(lockup.contentImage, 'thumbnailBadgeViewModel')?.text ?? null;
  return shape(lockup.contentId, title, texts, badge, now);
}

function fromVideoRenderer(renderer, now) {
  const title = renderer.title?.runs?.[0]?.text ?? renderer.title?.simpleText;
  if (!renderer.videoId || !title) return null;
  const texts = [renderer.publishedTimeText?.simpleText, renderer.upcomingEventData ? 'Premieres' : null].filter(Boolean);
  return shape(renderer.videoId, title, texts, renderer.lengthText?.simpleText ?? null, now);
}

function shape(videoId, title, texts, badge, now) {
  const published = texts.map((t) => parseAgo(t, now)).find(Boolean) ?? null;
  // A scheduled premiere is listed before anyone can watch it. It is left out entirely, not
  // marked seen, so the run after it goes live picks it up.
  const upcoming = !published && (/upcoming|premiere/i.test(badge ?? '') || texts.some((t) => /premieres|scheduled/i.test(t)));
  const duration = badge && /^\d+(:\d\d){1,2}$/.test(badge) ? badge : null;
  return {
    videoId,
    title,
    published,
    approximate: true,
    duration,
    upcoming,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

export function parseChannelPage(html, now = new Date()) {
  const data = extractInitialData(html);
  const videos = [
    ...[...walk(data, 'lockupViewModel')].map((l) => fromLockup(l, now)),
    ...[...walk(data, 'videoRenderer')].map((r) => fromVideoRenderer(r, now)),
  ].filter(Boolean);
  const unique = new Map(videos.map((v) => [v.videoId, v]));
  return [...unique.values()];
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchChannelPage(channelId, { fetchImpl = fetch, attempts = 3, sleep = wait, now } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(2000 * i);
    try {
      const res = await fetchImpl(PAGE(channelId), { headers: HEADERS, signal: AbortSignal.timeout(20000) });
      if (!res.ok) {
        last = `HTTP ${res.status}`;
        continue;
      }
      const videos = parseChannelPage(await res.text(), now ?? new Date());
      if (videos.length > 0) return videos;
      last = 'page listed no videos';
    } catch (err) {
      last = err.message;
    }
  }
  throw new Error(`${attempts} attempts failed, last: ${last}`);
}
