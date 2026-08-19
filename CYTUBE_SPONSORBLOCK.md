# CyTube SponsorBlock

This file gives you a channel-JS SponsorBlock integration for public `cytu.be` channels.

Full write-up: https://rennerdo30.github.io/send-to-cytube/guides/sponsorblock/

## What it does

- Fetches SponsorBlock segments for the current YouTube video
- Merges adjacent skip ranges
- Automatically seeks past those ranges for each viewer running channel JS
- In no-leader rooms, keeps local playback ahead of CyTube's server-autolead clock after skips
- If the current user is the CyTube leader, sends a `mediaUpdate` after the seek so it propagates through normal CyTube sync
- Shows a small status pill on the page for visibility

## Install

1. Open your channel on `cytu.be`
2. Go to `Channel Settings`
3. Open the admin/customization section for channel JS
4. Paste the contents of [cytube-sponsorblock.js](cytube-sponsorblock.js)
5. Save, then refresh the channel

## Limits

- This is channel JS, not a backend modification
- Users who disable channel JS will not get it
- Auto-skip runs locally for each viewer running channel JS
- Room-wide sync updates are only sent by the current CyTube leader
- In no-leader rooms, viewers who skip locally may be ahead of viewers who disable channel JS
- Non-YouTube media is ignored

## Tuning

Edit the `CONFIG` block near the top of [cytube-sponsorblock.js](cytube-sponsorblock.js) if you want to change:

- API base URL
- Categories to skip
- Poll interval
- Merge gap
- Seek padding
- Debug logging
