# Crop Cloud

A home for your own creative suite, in the spirit of a Creative Cloud launcher. Two apps are built: **PhotoCrop** (photo editor) and **FrameCrop** (video editor). The others are on the roadmap.

## Run it

Linux / Raspberry Pi:

```bash
./start.sh            # Crop Cloud
./start.sh framecrop  # straight into FrameCrop
```

Windows: double-click `start.bat` (or run `start.bat framecrop`). It uses Chrome or Edge.

Either one opens the suite in its own app window. You can also open `index.html` in Chrome or Edge directly. There is no install or build step.

That is the **test build**: it runs straight from this folder, so you always see the latest code. What you release to other people is the **desktop app** below.

## The desktop app (Windows)

The desktop app is the release version. It's the same hub and apps, plus:

- **Apps download one at a time.** People install only the apps they want (Apps › Install). Downloading needs a Crop Cloud account; the sign-in is remembered on that computer.
- **Updates from GitHub.** Crop Cloud updates itself in the background and installs on restart. App updates show up in Apps › Updates.
- Installed apps live in `%APPDATA%\Crop Cloud\apps\<app>\<version>\`. Uninstalling an app keeps your projects and settings.

Try it from this folder (Windows, macOS or Linux, Node.js 22):

```bash
cd desktop
npm install
npm start                  # uses the apps in apps/, like the test build
npm run start:downloads    # installs apps from the latest GitHub release instead
```

### Releasing

1. Test the change in the test build (`start.bat` / `./start.sh`).
2. Bump the version of each app you changed in `js/data.js`, and the suite version in both `js/data.js` (`BRAND.version`) and `desktop/package.json`. The two suite versions must match.
3. Commit, then tag and push: `git tag v0.2.1 && git push origin main v0.2.1`.

`.github/workflows/release.yml` then builds the Windows installer on GitHub and publishes a release with the installer, the self-update files, one zip per app and `apps-manifest.json`. Installed copies pick it up on their next check. The repo must be public for downloads to work without a GitHub login. The repo name lives in `desktop/release.json`.

## Accounts, cloud storage and sharing

Sign-in, the 10 GB cloud storage cap, bigger plans and shared projects run on Supabase, self-hosted on the Pi at `https://cropcloud.willythepi.com` (server folder `~/crop-cloud-server`, which has its own `CROPCLOUD.md` for adding friends, resetting passwords and backups). Sign-ups are invite-only. The database is [supabase/schema.sql](supabase/schema.sql), and [supabase/README.md](supabase/README.md) covers setting it up from scratch. If `js/config.js` has no server in it, sign-in is off and everything else still works.

## FrameCrop (the video editor)

The layout follows Premiere Pro's Editing workspace, and the Color workspace follows DaVinci Resolve's color tools.

- **Panels**: Project bin, Source monitor, Program monitor, Timeline, Effect Controls, Effects, Audio Track Mixer, Audio Meters, Graphics, History, Markers, plus Color Wheels, Curves, Nodes and Scopes. Workspaces: Editing, Color, Effects, Audio, Graphics (`Alt+Shift+1–5`). Drag the gutters to resize; press `` ` `` to maximize the panel under the pointer.
- **Timeline**: unlimited video/audio tracks, linked audio/video, snapping, markers, In/Out. Tools use Premiere's letters: Selection `V`, Track Select `A`, Ripple `B`, Rolling `N`, Rate Stretch `R`, Razor `C`, Slip `Y`, Slide `U`, Hand `H`, Zoom `Z`, Type `T`.
- **Editing keys**: `J K L`, `Space`, `I O`, `, .` (insert/overwrite from Source), `; '` (lift/extract), `Q W` (ripple trim to playhead), `Ctrl+K` (add edit), `Shift+Delete` (ripple delete), `Ctrl+D` (cross dissolve), `Ctrl+R` (speed), `Ctrl+L` (link), `M` (marker), `Ctrl+Alt+V` (paste attributes). Help › Keyboard Shortcuts lists them all.
- **Effects**: Motion (position, scale, rotation), Opacity with blend modes, Crop, speed, and Gaussian Blur, Sharpen, Black & White, Chroma Key, Vignette, Glow, Film Grain, Mosaic, Flip. Every number can be keyframed with the stopwatch.
- **Transitions**: Cross Dissolve, Dip to Black/White, Wipe, Push, Slide, Cross Zoom; audio Constant Power/Gain crossfades.
- **Color**: Lift/Gamma/Gain/Offset wheels, contrast/pivot/saturation/hue/temperature/tint/exposure, custom curves, serial nodes (`Alt+S`) with circle or rectangle power windows, `.cube` LUTs, looks, copy/paste grade, and Waveform, RGB Parade, Vectorscope and Histogram scopes.
- **Titles**: text with stroke, shadow and background; Lower Third / Center / Caption templates.
- **Export** (`Ctrl+M`): MP4 with H.264, HEVC, VP9 or AV1 (whatever the browser can encode) plus AAC or Opus audio; presets for YouTube 1080p/4K, web 720p, vertical, draft. Export Frame (`Ctrl+Shift+E`) saves a PNG.
- **Saving**: the project autosaves; media is kept on this computer so it reopens next time. Save/Open a `.fcrop` project file with `Ctrl+S` / `Ctrl+O`.
- **Remove Silence** (Sequence menu, `Ctrl+Alt+R`, or the waveform button on the timeline): finds quiet stretches and ripple-deletes them on all unlocked tracks so picture stays in sync. Use **Higher / Lower** (or drag the yellow line on the loudness graph) to set the threshold, plus Minimum silence and Padding. The cuts show in red on the timeline before you commit, and one Ctrl+Z undoes it.
- **Moving over from DaVinci Resolve** (File › Import Timeline, `Ctrl+Alt+I`, or just drop the file in): in Resolve use File › Export › Timeline and choose FCPXML, Final Cut Pro 7 XML, EDL or OpenTimelineIO (`.otio`). FrameCrop also reads these from Premiere and Final Cut. Point it at your media files or folder; anything not found comes in offline for relinking. Cuts, tracks, speed changes, titles and dissolves transfer; grades and effects don't (those formats don't carry them). Resolve's own `.drp` project files are a closed format and can't be read.
- **Sample video**: File › Open Sample Video (or the button in an empty Project panel) loads `apps/framecrop/samples/sample-talk.mp4`, a 32-second clip with spoken lines and pauses of different lengths, made for trying Remove Silence. `apps/framecrop/samples/make_sample.py` rebuilds it.

Limits compared with Premiere/Resolve: footage must be a format Chrome/Edge can play (MP4/MOV with H.264, HEVC on most Windows PCs, VP9, AV1, WebM; not ProRes or DNxHR). There are no proxies, multicam, nested sequences, Fusion-style compositing, motion tracking or parallel nodes yet. Very long audio is decoded into memory for waveforms and export.

## Crop Cloud (the hub)

- **Home**: new-file presets, quick actions, your apps, recent files, tutorials
- **Apps**: installed apps, the roadmap, categories, updates
- **Files**: recent images in a grid or list (drag images onto the window to add them)
- **Quick actions**: pick an action, then an image; PhotoCrop opens with it
- **Top bar**: main menu (≡), search everything (`Ctrl K`), help, notifications, account
- **Preferences** (`Ctrl ,`): theme, accent color, density, display name

## PhotoCrop (the editor)

It has Photoshop's layout: menu bar, options bar, tool column, document tabs, a panel dock, and a status bar.

- **Tools**: Move, Rectangular/Elliptical Marquee, Lasso/Polygonal Lasso, Magic Wand, Crop, Eyedropper, Spot Healing, Brush/Pencil, Clone Stamp, Eraser, Gradient/Paint Bucket, Blur/Sharpen/Smudge, Dodge/Burn/Sponge, Type, Rectangle/Ellipse/Line, Hand, Zoom. Same letters as Photoshop; Shift+letter cycles a group, right-click a tool for its flyout.
- **Layers**: blend modes, opacity, lock, masks (paint black/white on them), adjustment layers, drag to reorder, merge, flatten, Ctrl-click a thumbnail to load its selection.
- **Selections**: add/subtract/intersect, feather, expand, contract, border, inverse, Select Subject.
- **Edit**: unlimited-feel undo (last 50 steps, with a History panel), cut/copy/paste (including from other apps), Fill, Stroke, Free Transform (`Ctrl T`).
- **Image**: 13 adjustments with live preview (Levels, Curves, Hue/Saturation, Black & White…), Auto Tone/Contrast/Color, Image Size, Canvas Size, rotate/flip, crop, trim, Remove Background.
- **Filter**: Gaussian/Motion Blur, Unsharp Mask, Add Noise, Mosaic, Emboss, Find Edges, Twirl, Ripple, Spherize, Clouds, Vignette, High Pass, and more.
- **Files**: open PNG/JPG/WebP/GIF/SVG; save layered projects as `.pcrop`; Export As PNG, JPEG, or WebP with quality and scale.

Press `Ctrl+Alt+Shift+K` (Help › Keyboard Shortcuts) for every shortcut.

Not there yet compared with Photoshop: Pen/vector paths, layer groups, layer styles (drop shadow, stroke…), smart objects, PSD files, CMYK/16-bit, content-aware fill, actions.

## Project layout

```
index.html                Crop Cloud shell
css/hub.css               Crop Cloud styling
js/data.js                brand name, apps and versions, presets, quick actions, tutorials ← edit content here
js/config.js              Supabase project URL and anon key
js/store.js               settings and recent files (localStorage), shared with the apps
js/filestore.js           original files behind the recent list (IndexedDB), shared
js/platform.js            test build vs desktop app: installed apps, downloads, updates
js/account.js             sign-in, profile, storage use (Supabase)
js/hub.js, views.js, ui.js, icons.js
js/kit/                   util.js and ui.js shared by PhotoCrop and FrameCrop (menus, dialogs, controls)
js/vendor/                supabase.js (MIT)

apps/photocrop/
  index.html              editor shell
  css/photocrop.css       Photoshop-style dark/light theme
  js/document.js          documents, layers, masks, compositing
  js/history.js           undo/redo
  js/selection.js         selection masks, marching ants, flood fill, subject detection
  js/adjustments.js       adjustments and filters
  js/tools.js             tool framework + Hand/Zoom/Eyedropper
  js/paint.js             brush engine and painting tools
  js/select-tools.js      marquees, lassos, wand, crop, move
  js/transform.js         Free Transform, Type, shapes
  js/commands.js          every menu command and shortcut, plus image/layer/clipboard operations
  js/menus.js             menu bar
  js/panels.js            toolbar, tabs, status bar, Color/Swatches/Properties/Adjustments/History/Layers
  js/options.js           options bar
  js/dialogs.js           dialogs (New, Image Size, Curves, Export As, Color Picker…)
  js/app.js               startup, files, preferences, keyboard

apps/framecrop/
  index.html              editor shell
  css/framecrop.css       dark NLE theme
  vendor/mp4-muxer.js     MP4 muxer (MIT, see mp4-muxer.LICENSE)
  js/model.js             project, tracks, clips, timecode, edit operations, undo
  js/media.js             import, stored originals, thumbnails, waveforms, element pools, titles
  js/effects.js           effects, transitions, looks, keyframed parameters, LUT parsing
  js/gl.js                WebGL2 renderer: placement, color nodes, effects, blending, transitions
  js/player.js            playback clock, J/K/L, media sync, audio routing, meters
  js/edit.js              editing commands (insert, razor, ripple, lift/extract, transitions…)
  js/timeline.js          timeline panel and editing tools
  js/panels.js            Project, Source, Program, Effect Controls, Effects, Mixer, Graphics…
  js/color.js             color wheels, curves, nodes and windows, scopes
  js/export.js            WebCodecs export to MP4, audio mixdown, Export Frame
  js/silence.js           Remove Silence (detection, preview, ripple delete)
  js/interchange.js       timeline import: FCPXML, FCP7 XML, EDL, OTIO
  js/layout.js            workspaces and docking
  js/app.js               commands, menus, shortcuts, autosave, startup
  samples/                sample-talk.mp4 (+ .js copy for one-click loading), make_sample.py

desktop/                  Electron shell for the Windows app
  main.js                 window, app:// protocol (hub + downloaded apps), IPC
  preload.js              window.cropcloud bridge for the hub
  lib/apps.js             download, verify, unzip, uninstall apps
  lib/updates.js          self-updates (electron-updater)
  scripts/stage.js        copies the hub into the build
  scripts/pack-apps.js    zips each app and writes apps-manifest.json
  release.json            GitHub repo the releases come from
supabase/                 schema.sql and setup steps
.github/workflows/        release.yml: builds and publishes releases from version tags
```

## How the hub and apps talk

Every "Open", new-file, quick-action and recent-file click in Crop Cloud goes through `launchApp()` in `js/hub.js`. It leaves the request (new file size, files to open, quick action) in `sessionStorage` under `cropcloud.launch` and opens the app's `entry` from `js/data.js`. Original files are kept in IndexedDB by `js/filestore.js`, so either side can reopen them.
