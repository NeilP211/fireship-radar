// Decides what a fresh list of uploads means against what we have already handled.
//
// state/seen.json maps a channel id to the video ids already dealt with, newest first. A video
// lands there once it has a task, or once we have decided it never gets one (a Short, too old to
// be a new upload, or over the flood cap). A channel with no entry yet is seeded quietly: its
// current uploads are recorded and nothing is created, so adding a channel never dumps a month of
// old videos into Todoist.

export const HISTORY = 500;

// A video older than this that shows up "new" is not a new upload. It is an old one surfacing
// because the list changed shape: a newer upload deleted, or a switch between the page (30
// videos) and the feed (15).
export const MAX_AGE_DAYS = 3;

// Fireship posts two or three times a week. More than this many new uploads in one 30-minute run
// means something upstream broke, so only the newest few get tasks and the rest are recorded.
export const MAX_NEW = 3;

export function remember(state, channelKey, ids) {
  const merged = [...new Set([...ids, ...(state[channelKey] ?? [])])].slice(0, HISTORY);
  return { ...state, [channelKey]: merged };
}

export async function planChannel({ channel, videos, seen, now = new Date(), isShortFn = async () => false }) {
  const listed = videos.filter((v) => !v.upcoming);
  if (seen == null) return { seed: listed.map((v) => v.videoId), pending: [], skipped: [] };

  // Both sources list newest first, so reversing gives oldest first without trusting timestamps,
  // which the page only knows roughly.
  const known = new Set(seen);
  const fresh = listed.filter((v) => !known.has(v.videoId)).reverse();

  const pending = [];
  const skipped = [];
  const cutoff = now.getTime() - MAX_AGE_DAYS * 86400000;
  for (const video of fresh) {
    if (video.published && Date.parse(video.published) < cutoff) {
      skipped.push({ ...video, reason: `published ${video.published}, older than ${MAX_AGE_DAYS} days` });
    } else if (channel.skipShorts !== false && (await isShortFn(video.videoId))) {
      skipped.push({ ...video, reason: 'a Short' });
    } else {
      pending.push({ channel: channel.id, ...video });
    }
  }

  const overflow = pending.splice(0, Math.max(0, pending.length - MAX_NEW));
  for (const video of overflow) skipped.push({ ...video, reason: `over the ${MAX_NEW}-per-run flood cap` });
  return { seed: null, pending, skipped };
}
