// Where a channel's uploads come from: the Videos tab first, the RSS feed if the page fails
// (blocked, or YouTube reshaped its markup). Only RSS mixes in Shorts, so only an RSS result
// asks for the per-video Shorts check.

import { fetchChannelPage } from './page.mjs';
import { fetchFeed } from './feed.mjs';

export async function fetchVideos(channel, { page = fetchChannelPage, feed = fetchFeed } = {}) {
  let pageError;
  try {
    return { source: 'page', videos: await page(channel.channelId), needsShortCheck: false };
  } catch (err) {
    pageError = err.message;
  }
  try {
    const videos = await feed(channel.channelId);
    return { source: 'rss', videos, needsShortCheck: true, fallbackReason: pageError };
  } catch (err) {
    throw new Error(`page: ${pageError}; rss: ${err.message}`);
  }
}
