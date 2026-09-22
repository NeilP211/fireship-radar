import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseFeed } from '../scripts/lib/feed.mjs';
import { planChannel, remember, HISTORY } from '../scripts/lib/plan.mjs';

const videos = parseFeed(await readFile(new URL('./fixtures/fireship.xml', import.meta.url), 'utf8'));
const channel = { id: 'fireship', name: 'Fireship' };
const now = new Date('2026-09-21T22:00:00Z');
const neverShort = async () => false;
const allIds = videos.map((v) => v.videoId);

test('first run seeds every video and creates nothing', async () => {
  const plan = await planChannel({ channel, videos, seen: undefined, now, isShortFn: neverShort });
  assert.deepEqual(plan.seed, allIds);
  assert.deepEqual(plan.pending, []);
});

test('an unchanged feed produces nothing', async () => {
  const plan = await planChannel({ channel, videos, seen: allIds, now, isShortFn: neverShort });
  assert.equal(plan.seed, null);
  assert.deepEqual(plan.pending, []);
  assert.deepEqual(plan.skipped, []);
});

test('a new upload becomes pending, tagged with its channel', async () => {
  const plan = await planChannel({ channel, videos, seen: allIds.slice(1), now, isShortFn: neverShort });
  assert.equal(plan.pending.length, 1);
  assert.equal(plan.pending[0].videoId, 'TbkUKCm3CHQ');
  assert.equal(plan.pending[0].channel, 'fireship');
});

test('several new uploads come out oldest first', async () => {
  // Sep 17, Sep 15 and Sep 11 uploads, checked on Sep 18: the first two are fresh, Sep 11 is stale.
  const plan = await planChannel({
    channel,
    videos: videos.slice(1, 4),
    seen: [],
    now: new Date('2026-09-18T12:00:00Z'),
    isShortFn: neverShort,
  });
  assert.deepEqual(plan.pending.map((v) => v.videoId), ['7r4ikZHm9AI', 'LoLYw--s-5w']);
  assert.deepEqual(plan.skipped.map((v) => v.videoId), ['aspmNhKAFMc']);
});

test('an old video sliding back into the feed is skipped, not tasked', async () => {
  // Pretend the history lost the 2026-08-11 video, the way it looks when a newer upload is deleted.
  const seen = allIds.filter((id) => id !== 'aB5LGrHISqY');
  const plan = await planChannel({ channel, videos, seen, now, isShortFn: neverShort });
  assert.deepEqual(plan.pending, []);
  assert.equal(plan.skipped[0].videoId, 'aB5LGrHISqY');
  assert.match(plan.skipped[0].reason, /older than 3 days/);
});

test('Shorts are skipped by default and kept when skipShorts is false', async () => {
  const shortCheck = async (id) => id === 'TbkUKCm3CHQ';
  const skipping = await planChannel({ channel, videos, seen: allIds.slice(1), now, isShortFn: shortCheck });
  assert.deepEqual(skipping.pending, []);
  assert.equal(skipping.skipped[0].reason, 'a Short');

  const keeping = await planChannel({
    channel: { ...channel, skipShorts: false },
    videos,
    seen: allIds.slice(1),
    now,
    isShortFn: shortCheck,
  });
  assert.equal(keeping.pending.length, 1);
});

test('the Short check is not spent on stale videos', async () => {
  let calls = 0;
  const counting = async () => {
    calls++;
    return false;
  };
  await planChannel({ channel, videos, seen: [], now, isShortFn: counting });
  // Of all 15, only the Sep 21 upload is inside the three-day window, so it is the only one checked.
  assert.equal(calls, 1);
});

test('the Short check is skipped entirely when the source already excludes Shorts', async () => {
  const plan = await planChannel({ channel, videos, seen: allIds.slice(1), now });
  assert.equal(plan.pending.length, 1);
});

test('an upcoming premiere is neither seeded, tasked nor recorded', async () => {
  const premiere = { videoId: 'PPPPPPPPPPP', title: 'Soon', published: null, upcoming: true, url: 'u' };
  const seeded = await planChannel({ channel, videos: [premiere, ...videos], seen: undefined, now });
  assert.ok(!seeded.seed.includes('PPPPPPPPPPP'));

  const later = await planChannel({ channel, videos: [premiere, ...videos], seen: allIds, now });
  assert.deepEqual(later.pending, []);
  assert.deepEqual(later.skipped, []);
});

test('a new video with no known upload time still gets a task', async () => {
  const unknown = { videoId: 'UUUUUUUUUUU', title: 'Fresh', published: null, url: 'u' };
  const plan = await planChannel({ channel, videos: [unknown, ...videos], seen: allIds, now });
  assert.deepEqual(plan.pending.map((v) => v.videoId), ['UUUUUUUUUUU']);
});

test('the flood cap keeps only the newest few and records the rest', async () => {
  const burst = Array.from({ length: 5 }, (_, i) => ({ videoId: `burst${i}`, title: `B${i}`, published: null, url: 'u' }));
  const plan = await planChannel({ channel, videos: burst, seen: [], now });
  // burst0 is newest because lists run newest first.
  assert.deepEqual(plan.pending.map((v) => v.videoId), ['burst2', 'burst1', 'burst0']);
  assert.deepEqual(plan.skipped.map((v) => v.videoId), ['burst4', 'burst3']);
  assert.match(plan.skipped[0].reason, /flood cap/);
});

test('remember puts new ids first, drops duplicates, leaves other channels alone', () => {
  const state = { fireship: ['b', 'a'], other: ['z'] };
  assert.deepEqual(remember(state, 'fireship', ['c', 'a']), { fireship: ['c', 'a', 'b'], other: ['z'] });
  assert.deepEqual(remember({}, 'new', ['x']), { new: ['x'] });
  assert.deepEqual(state.fireship, ['b', 'a']);
});

test('remember caps the history', () => {
  const ids = Array.from({ length: HISTORY + 20 }, (_, i) => `v${i}`);
  const next = remember({}, 'fireship', ids);
  assert.equal(next.fireship.length, HISTORY);
  assert.equal(next.fireship[0], 'v0');
});
