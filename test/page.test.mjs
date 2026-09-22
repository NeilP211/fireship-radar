import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { parseAgo, extractInitialData, parseChannelPage, fetchChannelPage } from '../scripts/lib/page.mjs';

// The real Fireship Videos tab, fetched 2026-09-21 around 10:30 PM ET, trimmed to the
// ytInitialData script.
const html = gunzipSync(await readFile(new URL('./fixtures/fireship-videos.html.gz', import.meta.url))).toString('utf8');
const fetchedAt = new Date('2026-09-22T02:30:00Z');
const noSleep = async () => {};

const page = (data) => `<html><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`;

function lockup(id, title, { parts = ['1M', '2h ago'], badge = '5:00' } = {}) {
  return {
    lockupViewModel: {
      contentId: id,
      contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
      contentImage: { thumbnailViewModel: { overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: badge } }] } }] } },
      metadata: {
        lockupMetadataViewModel: {
          title: { content: title },
          metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: parts.map((content) => ({ text: { content } })) }] } },
        },
      },
    },
  };
}

test('reads all 30 videos off the real Fireship Videos tab', () => {
  const videos = parseChannelPage(html, fetchedAt);
  assert.equal(videos.length, 30);
  const [newest] = videos;
  assert.equal(newest.videoId, 'TbkUKCm3CHQ');
  assert.equal(newest.title, 'Did an ex-OpenAI researcher just make reasoning models obsolete?');
  assert.equal(newest.duration, '5:27');
  assert.equal(newest.approximate, true);
  assert.equal(newest.upcoming, false);
  assert.equal(newest.url, 'https://www.youtube.com/watch?v=TbkUKCm3CHQ');
  // "8h ago" at 02:30 UTC. The real upload was 17:52 UTC, inside that hour of slack.
  assert.equal(newest.published, '2026-09-21T18:30:00.000Z');
});

test('the page order matches the feed order, newest first', async () => {
  const { parseFeed } = await import('../scripts/lib/feed.mjs');
  const feed = parseFeed(await readFile(new URL('./fixtures/fireship.xml', import.meta.url), 'utf8'));
  const pageIds = parseChannelPage(html, fetchedAt).map((v) => v.videoId);
  assert.deepEqual(pageIds.slice(0, 15), feed.map((v) => v.videoId));
});

test('every video on the real page has an id, a title, a length and an age', () => {
  for (const video of parseChannelPage(html, fetchedAt)) {
    assert.match(video.videoId, /^[\w-]{11}$/);
    assert.ok(video.title.length > 0);
    assert.match(video.duration, /^\d+:\d\d$/);
    assert.ok(video.published, `${video.videoId} has no age`);
  }
});

test('parseAgo reads the compact and the spelled-out forms', () => {
  const now = new Date('2026-09-22T00:00:00Z');
  const hoursBack = (text) => (now - new Date(parseAgo(text, now))) / 3600000;
  assert.equal(hoursBack('8h ago'), 8);
  assert.equal(hoursBack('8 hours ago'), 8);
  assert.equal(hoursBack('1 hour ago'), 1);
  assert.equal(hoursBack('45m ago'), 0.75);
  assert.equal(hoursBack('45 minutes ago'), 0.75);
  assert.equal(hoursBack('4d ago'), 96);
  assert.equal(hoursBack('2w ago'), 336);
  assert.equal(hoursBack('1mo ago'), 720);
  assert.equal(hoursBack('Streamed 3 days ago'), 72);
  assert.equal(hoursBack('30 seconds ago'), 30 / 3600);
  assert.equal(parseAgo('945K', now), null);
  assert.equal(parseAgo('Premieres 9/22/26, 1:00 PM', now), null);
  assert.equal(parseAgo('3 fortnights ago', now), null);
  assert.equal(parseAgo(undefined, now), null);
});

test('a scheduled premiere is flagged as upcoming', () => {
  const [video] = parseChannelPage(page({ grid: [lockup('PPPPPPPPPPP', 'Soon', { parts: ['Premieres 9/22/26, 1:00 PM'], badge: 'UPCOMING' })] }));
  assert.equal(video.upcoming, true);
  assert.equal(video.published, null);
  assert.equal(video.duration, null);
});

test('non-video lockups (playlists) are ignored', () => {
  const playlist = lockup('PLxxxx', 'A playlist');
  playlist.lockupViewModel.contentType = 'LOCKUP_CONTENT_TYPE_PLAYLIST';
  const videos = parseChannelPage(page({ grid: [playlist, lockup('VVVVVVVVVVV', 'Real')] }));
  assert.deepEqual(videos.map((v) => v.videoId), ['VVVVVVVVVVV']);
});

test('still reads the older videoRenderer shape', () => {
  const now = new Date('2026-09-22T00:00:00Z');
  const data = {
    items: [{
      videoRenderer: {
        videoId: 'OOOOOOOOOOO',
        title: { runs: [{ text: 'Old shape' }] },
        publishedTimeText: { simpleText: '3 hours ago' },
        lengthText: { simpleText: '12:04' },
      },
    }],
  };
  const [video] = parseChannelPage(page(data), now);
  assert.equal(video.title, 'Old shape');
  assert.equal(video.duration, '12:04');
  assert.equal(video.published, '2026-09-21T21:00:00.000Z');
});

test('the same video listed twice comes out once', () => {
  const videos = parseChannelPage(page({ a: [lockup('DDDDDDDDDDD', 'Dup')], b: [lockup('DDDDDDDDDDD', 'Dup')] }));
  assert.equal(videos.length, 1);
});

test('a page without ytInitialData is an error, not an empty channel', () => {
  assert.throws(() => extractInitialData('<html>consent wall</html>'), /no ytInitialData/);
});

test('fetchChannelPage sends browser headers and retries a failure', async () => {
  const calls = [];
  const replies = [{ ok: false, status: 500 }, { ok: true, status: 200, text: async () => html }];
  const videos = await fetchChannelPage('UCsBjURrPoezykLs9EqgamOA', {
    sleep: noSleep,
    now: fetchedAt,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return replies.shift();
    },
  });
  assert.equal(videos.length, 30);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://www.youtube.com/channel/UCsBjURrPoezykLs9EqgamOA/videos');
  assert.match(calls[0].init.headers['accept-language'], /^en-US/);
  assert.equal(calls[0].init.headers.cookie, 'SOCS=CAI');
});

test('fetchChannelPage gives up on a page that never lists videos', async () => {
  await assert.rejects(
    fetchChannelPage('x', { sleep: noSleep, fetchImpl: async () => ({ ok: true, status: 200, text: async () => page({}) }) }),
    /3 attempts failed, last: page listed no videos/,
  );
});
