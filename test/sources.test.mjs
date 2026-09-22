import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchVideos } from '../scripts/lib/sources.mjs';

const channel = { id: 'fireship', channelId: 'UCsBjURrPoezykLs9EqgamOA' };
const video = { videoId: 'TbkUKCm3CHQ', title: 't', published: null, url: 'u' };
const fail = (message) => async () => { throw new Error(message); };

test('uses the page when it works and never touches the feed', async () => {
  const result = await fetchVideos(channel, {
    page: async (id) => {
      assert.equal(id, 'UCsBjURrPoezykLs9EqgamOA');
      return [video];
    },
    feed: fail('feed must not be called'),
  });
  assert.equal(result.source, 'page');
  assert.equal(result.needsShortCheck, false);
  assert.deepEqual(result.videos, [video]);
});

test('falls back to the feed, which needs the Shorts check', async () => {
  const result = await fetchVideos(channel, { page: fail('no ytInitialData on the page'), feed: async () => [video] });
  assert.equal(result.source, 'rss');
  assert.equal(result.needsShortCheck, true);
  assert.equal(result.fallbackReason, 'no ytInitialData on the page');
});

test('reports both failures when both sources are down', async () => {
  await assert.rejects(
    fetchVideos(channel, { page: fail('HTTP 429'), feed: fail('6 attempts failed, last: HTTP 404') }),
    /page: HTTP 429; rss: 6 attempts failed, last: HTTP 404/,
  );
});
