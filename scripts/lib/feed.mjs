// Reads a channel's public YouTube RSS feed, the fallback when the Videos tab (page.mjs) fails.
// No API key, no quota, the newest 15 uploads, and exact upload times. The catch: the endpoint is
// flaky. On 2026-09-21 it went from 3 in 5 requests answering to 1 in 10 within the hour, so a
// 404 means "ask again", not "the channel is gone".

const FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return match ? decodeEntities(match[1].trim()) : null;
}

export function parseFeed(xml) {
  const videos = [];
  for (const [, block] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const videoId = tag(block, 'yt:videoId');
    const title = tag(block, 'title');
    const published = tag(block, 'published');
    if (!videoId || !title || !published) continue;
    videos.push({ videoId, title, published, url: `https://www.youtube.com/watch?v=${videoId}` });
  }
  return videos;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchFeed(channelId, { fetchImpl = fetch, attempts = 6, sleep = wait } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(Math.min(1000 * 2 ** (i - 1), 15000));
    try {
      const res = await fetchImpl(FEED + encodeURIComponent(channelId), {
        headers: { 'user-agent': 'fireship-radar (+https://github.com/NeilP211/fireship-radar)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        last = `HTTP ${res.status}`;
        continue;
      }
      const videos = parseFeed(await res.text());
      // Every channel this watches has uploads, so an empty 200 is the same glitch as a 404.
      // Treating it as real would seed an empty history and replay the whole feed next run.
      if (videos.length > 0) return videos;
      last = 'feed came back with no entries';
    } catch (err) {
      last = err.message;
    }
  }
  throw new Error(`${attempts} attempts failed, last: ${last}`);
}
