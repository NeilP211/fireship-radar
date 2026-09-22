import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeEntities, parseFeed, fetchFeed } from '../scripts/lib/feed.mjs';

const fixture = await readFile(new URL('./fixtures/fireship.xml', import.meta.url), 'utf8');
const noSleep = async () => {};

function respond(status, body = '') {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

test('parses every entry in the real Fireship feed', () => {
  const videos = parseFeed(fixture);
  assert.equal(videos.length, 15);
  assert.deepEqual(videos[0], {
    videoId: 'TbkUKCm3CHQ',
    title: 'An ex-OpenAI researcher just deleted language from the LLM...',
    published: '2026-09-21T17:52:29+00:00',
    url: 'https://www.youtube.com/watch?v=TbkUKCm3CHQ',
  });
  assert.ok(videos.every((v) => /^[\w-]{11}$/.test(v.videoId)));
});

test('uses the entry title, not the channel title or the media title', () => {
  const titles = parseFeed(fixture).map((v) => v.title);
  assert.ok(!titles.includes('Fireship'));
});

test('decodes entities in titles', () => {
  const meta = parseFeed(fixture).find((v) => v.title.startsWith("Meta's"));
  assert.equal(meta.title, 'Meta\'s new model wants "deep access" to your personal life...');
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &#39;d&#39; &#x27;e&#x27; &apos;f&apos;'), "a & b <c> 'd' 'e' 'f'");
  assert.equal(decodeEntities('&nope; stays'), '&nope; stays');
});

test('skips an entry that is missing its id', () => {
  const xml = '<feed><entry><title>No id</title><published>2026-01-01T00:00:00+00:00</published></entry></feed>';
  assert.deepEqual(parseFeed(xml), []);
});

test('retries through the flaky 404s and 500s', async () => {
  const replies = [respond(404), respond(500), respond(200, fixture)];
  const urls = [];
  const videos = await fetchFeed('UCsBjURrPoezykLs9EqgamOA', {
    sleep: noSleep,
    fetchImpl: async (url) => {
      urls.push(url);
      return replies.shift();
    },
  });
  assert.equal(videos.length, 15);
  assert.equal(urls.length, 3);
  assert.equal(urls[0], 'https://www.youtube.com/feeds/videos.xml?channel_id=UCsBjURrPoezykLs9EqgamOA');
});

test('retries a network error too', async () => {
  let calls = 0;
  const videos = await fetchFeed('x', {
    sleep: noSleep,
    fetchImpl: async () => {
      if (calls++ === 0) throw new Error('socket hang up');
      return respond(200, fixture);
    },
  });
  assert.equal(videos.length, 15);
});

test('treats an empty 200 as a glitch, not an empty channel', async () => {
  const empty = '<?xml version="1.0"?><feed><title>Fireship</title></feed>';
  await assert.rejects(
    fetchFeed('x', { sleep: noSleep, attempts: 3, fetchImpl: async () => respond(200, empty) }),
    /3 attempts failed, last: feed came back with no entries/,
  );
});

test('gives up after the last attempt and says why', async () => {
  let calls = 0;
  await assert.rejects(
    fetchFeed('x', {
      sleep: noSleep,
      attempts: 4,
      fetchImpl: async () => {
        calls++;
        return respond(404);
      },
    }),
    /4 attempts failed, last: HTTP 404/,
  );
  assert.equal(calls, 4);
});

test('backs off between attempts, capped at 15s', async () => {
  const waits = [];
  await assert.rejects(
    fetchFeed('x', { attempts: 7, sleep: async (ms) => waits.push(ms), fetchImpl: async () => respond(500) }),
  );
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 15000, 15000]);
});
