# fireship-radar

Puts a Todoist task in my Inbox every time Fireship uploads a video, so I never miss one.

The task is due today, its title links straight to the video, and the description says how long it is:

```
Watch Fireship: Did an ex-OpenAI researcher just make reasoning models obsolete?
5:27 long. Fireship uploaded it Mon, Sep 21.
```

It runs on GitHub Actions every 30 minutes. No server, no dependencies, no YouTube API key.

## How it works

1. **Read the uploads.** The primary source is the channel's Videos tab
   (`youtube.com/channel/<id>/videos`), read from the JSON YouTube embeds in the page. It lists the
   newest 30 long-form videos with their lengths, and leaves Shorts out.
2. **Fall back to RSS.** If the page fails, the public RSS feed is tried. The feed is the obvious
   choice on paper, but on 2026-09-21 it answered only about 1 request in 10 and returned 404 or
   500 for the rest, which is why it is the backup and not the main source. Feed results mix in Shorts, so
   each new one gets a quick `youtube.com/shorts/<id>` check (200 means Short, a redirect means a
   regular video) and Shorts are skipped.
3. **Diff against `state/seen.json`.** Anything not seen before is new. A video is only written to
   the state file after its Todoist task exists, so if Todoist is down the video stays pending and
   the next run tries again instead of dropping it.
4. **Create the task** with `POST https://api.todoist.com/api/v1/tasks`.

### Guard rails

- **First run is quiet.** A channel with no history is seeded with whatever is on the page, and
  nothing is created. Adding a channel never dumps a month of old videos into Todoist.
- **Old videos are ignored.** Anything more than 3 days old that shows up as "new" (for example
  because a newer video was deleted) is recorded and skipped.
- **Flood cap.** At most 3 tasks per channel per run. More than that in half an hour means
  something upstream broke.
- **Premieres wait.** A scheduled premiere is not recorded until it is actually watchable.

## Setup

1. Get a Todoist API token: Todoist, Settings, Integrations, Developer, copy the API token.
2. Save it as a repo secret named `TODOIST_TOKEN`:
   ```
   gh secret set TODOIST_TOKEN -R NeilP211/fireship-radar
   ```
3. Actions tab, **Check for new videos**, Run workflow with **check_token** ticked to confirm it
   works without creating anything.

## Watching more channels

Add an entry to `data/channels.json`. The first run after that seeds it quietly.

```json
{
  "id": "fireship",
  "name": "Fireship",
  "channelId": "UCsBjURrPoezykLs9EqgamOA"
}
```

Optional fields per channel:

| Field | Default | What it does |
|---|---|---|
| `projectId` | Inbox | Todoist project to put the task in |
| `due` | `today` | Any Todoist due string, like `tomorrow` or `saturday` |
| `labels` | none | Label names to attach |
| `prefix` | `Watch <name>:` | Text before the video title |
| `skipShorts` | `true` | Set `false` to get tasks for Shorts too |

A channel id starts with `UC`. It is in the page source of any channel page as `"externalId"`.

## Running locally

```
npm test                          # 53 tests, no network
node scripts/check.mjs            # writes new.json and updates state/seen.json
DRY_RUN=1 node scripts/todoist.mjs   # print the tasks it would create
TODOIST_TOKEN=... node scripts/todoist.mjs --check   # confirm a token works
```

Manual runs in Actions also take **dry_run**, which prints the tasks and commits nothing.

`keepalive.yml` stops GitHub from switching the schedule off after 60 quiet days.
