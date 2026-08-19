# Send to CyTube

A Chrome (Manifest V3) extension that queues the YouTube video you are looking at into a
[CyTube](https://cytu.be) channel you already have open in another tab — one click, no
login, no server.

The repository also ships [`cytube-sponsorblock.js`](cytube-sponsorblock.js), a
standalone CyTube channel-JS script that skips community-submitted SponsorBlock segments
during playback.

**Documentation:** https://rennerdo30.github.io/send-to-cytube

## Why

Adding a video to a CyTube queue normally means copying a URL, switching tabs, finding
the add-media field, and pasting. That is a lot of friction for something you do
constantly during a watch party.

Most tools that automate it would need your CyTube credentials or a relay server. This
one needs neither. It injects a short function into the CyTube tab you point it at and
emits the same socket.io event the CyTube web client emits when you add media yourself:

```js
socket.emit("queue", { id, type: "yt", pos, temp });
```

Because that happens inside your already-connected page, it reuses your session, your
login or guest name, and your channel permissions exactly as they are. No credentials are
stored, nothing is proxied, and no channel you do not already have access to becomes
reachable.

## Install (unpacked)

There is no Chrome Web Store listing, and there is no build step.

1. Clone the repository:
   ```bash
   git clone https://github.com/rennerdo30/send-to-cytube.git
   ```
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the repository root — the folder containing `manifest.json`

The first time you send to a given CyTube host, Chrome asks for site access to that
origin. Accept it once per host.

> If the in-page button reports `Setup needed` with a site-access error, Chrome refused
> the permission prompt in that context. Open the toolbar popup and send once from there
> for that host; the in-page button works afterwards.

### SponsorBlock channel script

Independent of the extension. Open your channel on `cytu.be` → **Channel Settings** →
the channel-JS field, paste the contents of `cytube-sponsorblock.js`, save, and refresh.

## Usage

Open your CyTube channel in a tab and make sure it is connected. Then use any of:

| Entry point | Behaviour | Feedback |
| --- | --- | --- |
| Floating `Send to CyTube` button on a YouTube watch page | Sends with saved defaults | Button relabels: `Sending...` → `Queued` / `Setup needed` |
| `...` options button beside it | Panel for target tab, position, temp | Inline status line |
| Right-click a YouTube video link → `Send to CyTube` | Sends with saved defaults | Toolbar badge `OK` / `ERR` with tooltip |
| Toolbar popup | Pre-fills from the active tab, or paste any supported URL | Inline status line |

Supported URL shapes: `watch`, `youtu.be`, `shorts`, `live`, and `embed`, on
`youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, and `youtu.be`.
Every URL is reduced to its 11-character video ID before anything is sent.

Success is confirmed, not assumed: the injected code listens for CyTube's `queue` and
`queueFail` replies and matches the echoed packet against your video ID and username. If
no reply arrives within 5 seconds you get an honest `Request sent` rather than a claimed
success.

## How the CyTube channel is targeted

You never enter a channel name. Detection is heuristic on the outside and verified on the
inside.

1. **Discover** — every open tab with an `http(s)` URL whose title or URL contains
   `cytube` or `cytu.be`, *or* whose path matches `/r/<channel>`. The path rule is what
   makes self-hosted instances work without configuration.
2. **Rank** — additive scoring on title and URL: `cytube` +5, `cytu.be` +4, `/r/` +3.
   Highest wins; ties break by tab order. The last tab you used wins if it is still
   present. Both dropdowns list every candidate so you can override the choice.
3. **Request access** — the chosen tab's origin is requested via
   `chrome.permissions.request`, one host at a time. The manifest declares only
   `optional_host_permissions`, so a fresh install can reach no site until you point it
   at one.
4. **Verify** — the injected function runs with `world: "MAIN"` and refuses to emit
   unless `window.socket` is live, `window.CHANNEL.name` exists, the socket is not
   disconnected, and `window.hasPermission("playlistadd")` passes (plus `playlistnext`
   for the `next` position).

Loose matching is safe because step 4 rejects any tab that is not really a CyTube channel
page before anything is emitted.

## SponsorBlock behaviour

`cytube-sponsorblock.js` runs in the browser of each viewer who has channel JS enabled.

- Tracks the current media via `window.PLAYER` plus a hint captured from
  `Callbacks.changeMedia`; non-YouTube media is ignored.
- Fetches segments from the SponsorBlock API with `service=YouTube&actionType=skip` and
  one `category=` parameter per configured category.
- Merges ranges closer than `mergeGapSeconds` so near-adjacent segments cause one seek
  rather than several.
- Polls `PLAYER.getTime()` every `pollMs` and seeks to `range.end + seekPaddingSeconds`,
  with guards against seek loops. Seeking probes several player APIs in turn.
- **If you are the channel leader**, emits `mediaUpdate` after the seek so the room
  follows through CyTube's normal sync.
- **If the room has no leader**, accumulates a local offset and adds it to incoming
  `changeMedia` / `mediaUpdate` `currentTime` values, keeping local playback ahead of the
  server's autolead clock. The offset resets on media change and on `setLeader`.
- Shows a status pill (`ui: true`) with the current state or the reason it is idle.

Limits worth knowing: it is channel JS, not a server modification, so viewers with
channel JS disabled get none of it and may drift out of sync with those who do; room-wide
sync updates are only sent by the current leader; and segment quality is whatever
SponsorBlock's contributors submitted.

## Configuration

No options page, no environment variables.

The extension stores three keys in `chrome.storage.sync`, rewritten after every send:

| Key | Values | Default when unset |
| --- | --- | --- |
| `lastTargetTabId` | tab ID | `null` (falls back to top-ranked tab) |
| `defaultPosition` | `"end"` \| `"next"` | `"end"` |
| `defaultTemp` | boolean | `true` |

The SponsorBlock script is tuned by editing the `CONFIG` object at the top of the file:

```js
var CONFIG = {
  apiBase: "https://sponsor.ajay.app",
  categories: ["sponsor", "selfpromo", "interaction", "intro", "outro", "preview", "filler"],
  pollMs: 400,
  mergeGapSeconds: 0.35,
  seekPaddingSeconds: 0.08,
  ui: true,
  debug: false
};
```

## Tech stack

- **Extension** — Chrome Manifest V3, plain browser JavaScript, HTML, and CSS. No
  bundler, no framework, no dependencies. Permissions: `storage`, `tabs`, `scripting`,
  `contextMenus`, plus `optional_host_permissions` requested at runtime.
- **SponsorBlock client** — a single ES5-compatible IIFE for the CyTube channel-JS field,
  using `XMLHttpRequest` against the public SponsorBlock API.
- **Docs** — Astro Starlight with the Galaxy theme, deployed to GitHub Pages by
  `.github/workflows/deploy.yml`.

```bash
npm run install:docs   # install docs dependencies
npm run dev            # local docs preview
npm run build          # static docs output in docs/dist
```

## Project layout

```
manifest.json            MV3 declaration
background.js            Service worker: context menu, messaging, injection, URL parsing
youtube-page.js/.css     Content script: floating button and options panel
popup.html/.js/.css      Toolbar popup
cytube-sponsorblock.js   Standalone CyTube channel JS (not loaded by the extension)
assets/                  Icons and logo
docs/                    Astro Starlight documentation site
```

`parseYouTubeInput` and the tab-detection helpers are duplicated across the service
worker, content script, and popup — an MV3 extension without a bundler cannot share
modules between those contexts. Keep them in sync when editing.

## License

[MIT](LICENSE)
