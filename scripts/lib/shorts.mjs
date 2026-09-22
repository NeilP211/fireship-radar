// The feed mixes Shorts in with regular uploads and marks neither. youtube.com/shorts/<id> answers
// 200 for a Short and redirects (303) to /watch for everything else. Checked 2026-09-21 against
// fwBIZRq-vzY (a Fireship Short) and TbkUKCm3CHQ (a regular video), with GET and HEAD alike.
//
// Anything other than a clean 200 counts as "not a Short", so a blocked or failed check still
// ends up as a task. Getting one Short too many beats silently dropping a real video.

export async function isShort(videoId, { fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`https://www.youtube.com/shorts/${encodeURIComponent(videoId)}`, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}
