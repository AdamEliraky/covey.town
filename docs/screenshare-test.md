# Screen-share test build (Task 3 → Stories 1–2)

This build uses the screen-sharing code that already exists in `VideoFrontend`.
It adds a test panel so each client can record what it sees.

## Enabling the test build

In `frontend/.env`, add:

```
NEXT_PUBLIC_SCREENSHARE_TEST=true
```

Restart `npm start` in `frontend/`. After you join a town, a **Screen share test** panel appears in the top-right corner.
If the flag is unset, the panel is not rendered, and the app behaves as before.

## What is in the build

| Piece | Where | Notes |
|---|---|---|
| Share button (existing) | `MenuBar` → `ToggleScreenShareButton` | The video bar already had this button. It is hidden while you are sharing, when the "You are sharing your screen / Stop Sharing" banner is shown. It is also hidden on mobile. |
| Share/Stop button (test) | `ScreenShareTest/ScreenShareTestPanel.tsx` | Calls the same `toggleScreenShare` from `VideoContext`. |
| Start/stop/cancel logic | `VideoProvider/useScreenShareToggle` | Publishes a track named `screen`. See the fixes below. |
| Event log | `ScreenShareTest/screenShareTestLog.ts` | Each client logs its own events. The log also goes to the console with a `[ScreenShareTest]` prefix. **Copy log** puts the log on the clipboard. |

### Fixes made to `useScreenShareToggle`

- **Double click:** a second click while the picker is open no longer opens a second picker or publishes a second track.
- **Stop called twice:** the browser's "Stop sharing" bar, the in-app button and a room disconnect can all call stop. Cleanup now runs only once.
- **Disconnect:** stopping now goes through `stopScreenShare('disconnect')`. If unpublishing fails, the captured track is still stopped, so the browser's sharing indicator goes away.
- **Publish failure:** if publishing fails, the captured screen track is stopped instead of being left open.
- **Cancel:** cancelling the picker (`NotAllowedError` / `AbortError`) still shows no error dialog. It is now logged as `Screen picker cancelled`.

Unit tests: `useScreenShareToggle.test.tsx` covers start, button stop, browser stop, double stop, cancel (both error names), other picker errors, double click, publish failure, and stopping on disconnect.

## Important architectural finding (from reading the code)

- **One Twilio room per town:** the server issues one Twilio room per *town* (`TwilioVideo.getTokenForTown` → `VideoGrant({ room: coveyTownID })`).
- **Proximity is applied in the UI only:** proximity is applied only in the UI, in `ParticipantList`, which filters by `usePlayersInVideoCall()` (an 80px radius, or the same interactable).
- **No subscription rules:** no track subscription rules are configured.
- **What to confirm:** the code suggests that every client in the town subscribes to the `screen` track, even players outside the area. The multi-client test below should confirm this using the panel's **Screen** column.
- **The normal grid never shows the screen:** the normal video grid never renders a screen track. `Participant` is rendered without `enableScreenShare`, and `MainParticipant` is commented out in `Room.tsx`. In the current app, only the sharer sees a banner, and viewers see only a small screen-share icon on the sharer's tile. The test panel renders the screen track so the test can be observed.

## Manual test checklist

Use three browser windows or machines: **P** (presenter), **V** (viewer next to P), and **O** (player outside the area).
After each step, write down what each client's panel shows: Sharer, "Screen track on this client", and the Screen/Audio columns. Then press **Copy log**.

| # | Step | P sees | V sees | O sees | O receives video? |
|---|---|---|---|---|---|
| 1 | P clicks Share, then cancels the picker | | | | |
| 2 | P clicks Share and picks a screen or window | | | | |
| 3 | P stops with the in-app Stop button | | | | |
| 4 | P shares again, then stops with the browser's "Stop sharing" bar | | | | |
| 5 | P shares, then V walks out of range (room exit) | | | | |
| 6 | P shares, then O walks into range | | | | |
| 7 | P shares, then P leaves the area | | | | |
| 8 | P shares, then P closes the tab or disconnects | | | | |
| 9 | P shares, then V tries to share (should be blocked) | | | | |
| 10 | Spectator audio: while P shares, V and O talk. Who hears whom? | | | | |

Notes for step 10: remote audio is played only for tiles in the grid, so only for nearby players. The panel's **Audio** column shows whether audio is *subscribed* (received), which is a separate question from whether it is *played*.
