#!/usr/bin/env node
// Creates one Todoist task per video in new.json and records each in state/seen.json the moment
// its task exists. A failure on one video leaves only that video pending, so the next run retries
// it without duplicating the ones that already went through.
//
//   node scripts/todoist.mjs           create tasks for new.json (TODOIST_TOKEN required)
//   DRY_RUN=1 node scripts/todoist.mjs print the task bodies, touch nothing
//   node scripts/todoist.mjs --check   confirm the token works without creating anything

import { fileURLToPath } from 'node:url';
import { buildTask } from './lib/task.mjs';
import { remember } from './lib/plan.mjs';
import { CHANNELS, STATE, OUT, readJson, writeJson } from './check.mjs';

const API = 'https://api.todoist.com/api/v1';

async function call(path, { token, fetchImpl = fetch, method = 'GET', body, requestId } = {}) {
  const headers = { authorization: `Bearer ${token}` };
  if (body) headers['content-type'] = 'application/json';
  if (requestId) headers['x-request-id'] = requestId;
  const res = await fetchImpl(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Todoist ${method} ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export function createTask(body, options) {
  return call('/tasks', { ...options, method: 'POST', body });
}

export async function deliver(pending, channels, state, { create, dryRun = false, log = console.log }) {
  const byId = new Map(channels.map((c) => [c.id, c]));
  let next = state;
  let created = 0;
  const failed = [];
  for (const video of pending) {
    const channel = byId.get(video.channel) ?? { id: video.channel, name: video.channel };
    const body = buildTask(video, channel);
    if (dryRun) {
      log(`[dry run] ${JSON.stringify(body)}`);
      continue;
    }
    try {
      const task = await create(body, { requestId: `fireship-radar-${video.channel}-${video.videoId}` });
      next = remember(next, video.channel, [video.videoId]);
      created++;
      log(`created ${task.id}: ${body.content}`);
    } catch (err) {
      failed.push({ videoId: video.videoId, error: err.message });
      log(`FAILED ${video.videoId}: ${err.message}`);
    }
  }
  return { state: next, created, failed };
}

async function main() {
  const token = process.env.TODOIST_TOKEN;
  const dryRun = Boolean(process.env.DRY_RUN);

  if (process.argv.includes('--check')) {
    if (!token) throw new Error('TODOIST_TOKEN is not set');
    const { results } = await call('/projects', { token });
    const inbox = results.find((p) => p.inbox_project);
    console.log(`token works: ${results.length} project(s) visible, inbox ${inbox ? inbox.id : 'not found'}`);
    return;
  }

  const pending = await readJson(OUT, []);
  if (pending.length === 0) {
    console.log('nothing new');
    return;
  }
  if (!token && !dryRun) {
    console.error(`TODOIST_TOKEN is not set, ${pending.length} video(s) stay pending until it is`);
    process.exitCode = 1;
    return;
  }

  const channels = await readJson(CHANNELS, []);
  const state = await readJson(STATE, {});
  const result = await deliver(pending, channels, state, {
    dryRun,
    create: (body, options) => createTask(body, { ...options, token }),
  });
  if (!dryRun) await writeJson(STATE, result.state);
  console.log(`${result.created} task(s) created, ${result.failed.length} failed`);
  if (result.failed.length) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
