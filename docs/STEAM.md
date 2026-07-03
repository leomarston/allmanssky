# Shipping AllMansSky to Steam

The game is a self-contained WebGL2 app, so the Steam build is an Electron
shell (`steam/`) that serves the game from an in-process loopback server and
opens it fullscreen. No code changes are needed between web and desktop.

## Build the desktop app

```bash
cd steam
npm install            # electron + electron-builder (dev machine, needs network)
npm start              # run windowed with devtools (--debug)
npm run dist           # produce dist/<platform>-unpacked for the current OS
```

`electron-builder.json` packs `index.html`, `src/`, `vendor/` and the shell.
Targets are `dir` (unpacked folders) because Steam wants raw depot files, not
installers. Build on each OS you ship (or use electron-builder's cross-build
in CI). F11 / Alt+Enter toggle fullscreen; the shell binds only to 127.0.0.1.

## Steamworks checklist

1. **App setup** — On [partner.steamgames.com](https://partner.steamgames.com):
   create the app ($100 fee), fill the store page (use `test/screenshots/`
   captures — they're real gameplay), set system requirements (any GPU with
   WebGL2; 4 GB RAM).
2. **Depots** — one depot per OS containing the matching
   `steam/dist/<platform>-unpacked/` contents. Launch option: the AllMansSky
   executable, no arguments.
3. **Upload** — `steamcmd +login <user> +run_app_build app_build.vdf`
   (template in Steamworks docs; point ContentRoot at the unpacked dir).
4. **Steam Overlay** works with Electron out of the box in most cases; if it
   doesn't render, add `in-process-gpu` to Electron switches and retest.
5. **Achievements/Cloud (optional)** — add
   [`steamworks.js`](https://github.com/ceifa/steamworks.js) to `steam/`,
   init with your appid in `main.cjs`, and bridge to the game through a
   preload script + `postMessage`. Save files live in `localStorage`
   (Electron persists them under the app's userData dir); for Steam Cloud,
   set Auto-Cloud on that directory.
6. **Testing** — place a `steam_appid.txt` (your appid) next to the built
   executable to run outside Steam during development.

## Honest state

- The shell is scaffolded and reviewed but was authored in a headless
  environment — do one `npm start` smoke run on a desktop before uploading.
- Pricing/marketing/age-rating flows in Steamworks are manual.
- The game is single-player with local saves: no server infrastructure needed.
