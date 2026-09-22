// Turns a video into a Todoist task body for POST /api/v1/tasks.
//
// The title is a markdown link, so tapping the task in the Todoist app opens the video. Due today,
// so it shows up in the Today view on the day it drops. No project_id means the Inbox.

const DAY = { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' };
const day = new Intl.DateTimeFormat('en-US', DAY);
const dayAndTime = new Intl.DateTimeFormat('en-US', { ...DAY, hour: 'numeric', minute: '2-digit' });

// En and em dash, built from char codes so the source itself stays free of them.
const LONG_DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`, 'g');
const NARROW_SPACE = new RegExp(String.fromCharCode(0x202f), 'g');

export function cleanTitle(title) {
  return title
    .replace(LONG_DASHES, '-')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\s+/g, ' ')
    .trim();
}

// The feed gives an exact upload time. The page only says "8h ago", so an approximate time gets
// the day alone rather than a precise-looking clock time that could be off by an hour.
export function uploadedAt(iso, approximate = false) {
  if (approximate) return day.format(new Date(iso));
  return `${dayAndTime.format(new Date(iso)).replace(NARROW_SPACE, ' ')} ET`;
}

export function describe(video, channel) {
  const parts = [];
  if (video.duration) parts.push(`${video.duration} long.`);
  if (video.published) parts.push(`${channel.name} uploaded it ${uploadedAt(video.published, video.approximate)}.`);
  return parts.join(' ');
}

export function buildTask(video, channel) {
  const prefix = channel.prefix ?? `Watch ${channel.name}:`;
  const task = {
    content: `${prefix} [${cleanTitle(video.title)}](${video.url})`,
    description: describe(video, channel),
    due_string: channel.due ?? 'today',
  };
  if (channel.projectId) task.project_id = channel.projectId;
  if (channel.labels?.length) task.labels = channel.labels;
  return task;
}
