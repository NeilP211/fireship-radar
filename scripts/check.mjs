#!/usr/bin/env node
// Reads the uploads of every channel in data/channels.json and writes the ones that still need a
// task to new.json. Seeds and skips (Shorts, stale entries) go straight into state/seen.json.
// Videos that need a task do NOT: todoist.mjs records each one only after its task exists, so a
// Todoist outage leaves the video pending for the next run instead of losing it.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchVideos } from './lib/sources.mjs';
import { isShort } from './lib/shorts.mjs';
import { planChannel, remember } from './lib/plan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CHANNELS = join(ROOT, 'data/channels.json');
export const STATE = join(ROOT, 'state/seen.json');
export const OUT = join(ROOT, 'new.json');

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

export const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

async function main() {
  const channels = await readJson(CHANNELS, []);
  let state = await readJson(STATE, {});
  const pending = [];

  for (const channel of channels) {
    let fetched;
    try {
      fetched = await fetchVideos(channel);
    } catch (err) {
      console.error(`${channel.id}: FAILED, keeping previous state (${err.message})`);
      process.exitCode = 1;
      continue;
    }
    const { videos, source } = fetched;
    if (fetched.fallbackReason) console.log(`${channel.id}: page failed (${fetched.fallbackReason}), used the RSS feed`);

    const plan = await planChannel({
      channel,
      videos,
      seen: state[channel.id],
      isShortFn: fetched.needsShortCheck ? isShort : undefined,
    });
    if (plan.seed) {
      state = remember(state, channel.id, plan.seed);
      console.log(`${channel.id}: first run, seeded ${plan.seed.length} existing video(s) from the ${source} quietly`);
      continue;
    }
    console.log(`${channel.id}: ${videos.length} listed on the ${source}, ${plan.pending.length} new, ${plan.skipped.length} skipped`);
    for (const video of plan.skipped) console.log(`   skip ${video.videoId} ${video.title} (${video.reason})`);
    for (const video of plan.pending) console.log(`   new  ${video.videoId} ${video.title}`);
    state = remember(state, channel.id, plan.skipped.map((v) => v.videoId));
    pending.push(...plan.pending);
  }

  await writeJson(OUT, pending);
  await writeJson(STATE, state);
  console.log(`${pending.length} video(s) written to new.json`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
