# Layout Stage — Claude Code Handoff

Oct 24, 2026 · @Jesse

## Summary

Layout Stage turns 1 to 3 website screenshots into a finished Pinterest pin or Etsy listing image in under a minute. You drop screenshots on a canvas, drag them into place, pick a frame and background, and export a PNG or JPG.

- **Who it's for:** Jesse, a designer who sells website designs and promotes them on Pinterest and Etsy. One user, desktop browser first.
- **The one job:** present website layouts as plain rectangles (rounded corners, optional border, drop shadow) on a styled background, sized for the platform. No device frames, no 3D camera angles, no preset layouts.
- **What exists today:** a working single-file prototype, `layout-stage.html`, sent alongside this doc and live as the [Layout Stage prototype](https://claude.ai/artifact/QMDuh1NMWEnEVdya3WSeL1). It covers every v1 feature below except URL capture and autosave.
- **How to use the prototype:** treat it as the behavioral reference. The new build should look and act the same, restructured into a real codebase, plus the items marked **New**.
- **New in this build:** capture a screenshot from a URL (section 4) and autosave, so a reload never loses the canvas.

## Start it in Claude Code

Set up an empty folder with the prototype and this doc, then paste the prompt below. Claude Code works best with the reference file in the repo, since it can read the exact math instead of guessing.

1. Create an empty folder named `layout-stage` and open Claude Code in it.
2. Make a `reference/` folder and put `layout-stage.html` in it.
3. Export this doc as Markdown and save it as `docs/HANDOFF.md`.
4. Paste this prompt:

```text
Read docs/HANDOFF.md and reference/layout-stage.html before writing any code.

Build Layout Stage as a Next.js (App Router) + TypeScript app, following the
handoff. The HTML file is a working prototype: match its behavior, layout and
rendering math, but restructure it into the typed modules in section 7.

First, write a short CLAUDE.md that records the dev/test commands and the rule
"preview and export must render identically: change both or neither".

Then work milestone by milestone (section 8). After each one, run the app,
check its done criteria, commit, and tell me what to look at in the browser.

Ask me before adding any dependency the handoff doesn't name.
```

5. After milestone 1, open the app next to the prototype and compare them at the same canvas size. Differences there are cheaper to fix early.

## v1 features

Everything here already works in the prototype unless it's marked **New**. Each bullet is an acceptance check.

### Canvas

| Preset | Size (px) | Ratio | Default export | Safe-area overlay |
| --- | --- | --- | --- | --- |
| Pinterest pin | 1000 × 1500 | 2:3 | 2× (2000 × 3000) | Central 80% |
| Etsy listing | 3000 × 2250 | 4:3 | 1× | 5:4 thumbnail crop |
| Etsy square | 2000 × 2000 | 1:1 | 1× | 5:4 thumbnail crop |
| Portrait | 1080 × 1350 | 4:5 | 2× | Central 80% |
| Custom | 200 to 6000 per side | any | 1× | Central 80% |

Pinterest recommends 1000 × 1500 at 2:3 and suggests keeping text inside the central 80%, because it rounds corners and overlays buttons on hover ([socialk](https://socialk.it/en/sizes/pinterest-pin-size)). Etsy wants at least 2000 px on the shortest side at 4:3 or 1:1, and auto-crops thumbnails to a 570 × 456 (5:4) frame ([Outfy](https://www.outfy.com/blog/etsy-listing-photo-size/)). On a square canvas that crop removes 200 px from the top and bottom.

- The canvas fits the viewport with padding and shows the zoom %.
- Changing the canvas re-runs the starting arrangement. It's undoable.
- Export caps the long side at 8000 px.

### Layouts (1 to 3 images)

- A 1 / 2 / 3 toggle places images at starting positions for the canvas shape: a diagonal cascade on portrait canvases; side by side, or a hero with two behind it, on square and landscape. These are starting points, not preset layouts.
- Drag to move. The corner handle resizes and keeps the aspect ratio. Arrow keys nudge 1 px, with Shift 10 px.
- Dragging snaps to the canvas center lines and to other images' edges and centers, within 7 screen px, and shows magenta guides. Holding Alt turns snapping off.
- Center H, Center V, Center group (centers the bounding box of all images), Re-arrange, Bring forward / Send back (also `]` and `[`).
- Removing a layout moves it to the end of the list and lowers the count. Clicking empty canvas or Esc deselects.

### Crop and scroll

- Per-image crop: Full, 16:10, 4:3, 1:1, 4:5, 9:16.
- When a crop cuts the image, a Scroll slider (vertical) or Pan slider (horizontal) picks the visible part, 0 to 100%, with the same meaning as CSS `object-position`.
- Auto-crop when an image is added: ratio ≥ 0.9 shows Full. A taller image at least 1280 px wide (a full-page desktop capture) gets 16:10. A narrower one (a phone) gets Full, or 9:16 if its ratio is under 0.4.
- An image's height is capped at 90% of the canvas when it's added or its crop changes.

### Adding images

- Upload button (several files at once), drop on the canvas, drop on a layout row, or paste with ⌘V.
- Several files at once fill layouts 1 to n and set the count to n.
- One file dropped on an image replaces it. Dropped elsewhere, it fills the first sample slot, else adds a layout if there are fewer than 3, else replaces layout 1.
- Paste replaces the selected image, otherwise it follows the drop-elsewhere rule.
- Non-images are rejected with a message naming PNG, JPG and WebP.
- **New:** From URL (section 4).

### Frame (applies to every image)

- Corners 0 to 80, border 0 to 16 plus color.
- Shadow presets None, Soft, Lifted, Float, Hard. Custom controls: blur 0 to 200, drop −60 to 160, shift −80 to 80, strength 0 to 100%, color. Moving a shadow slider marks the preset as custom.

### Background

- Solid: 12 swatches and a picker. Gradient: 10 presets, from / to colors, angle. Mesh: 6 presets, 4 colors, shuffle glow positions.
- Image: upload, or use a blurred copy of the selected layout. Blur 0 to 120, darken 0 to 70%.
- Grain 0 to 40 on every background type.

### Styles

- Six built-ins: Blush mesh, Gallery white, Midnight, Sage paper, Poster, Dusk. A style is a frame plus a background, never the images.
- Save current style and delete saved ones. Background photos aren't stored in styles; a saved image style falls back to the solid color.

### Export

- PNG, or JPG at quality 0.92, at 1× or 2×. The top bar shows the final pixel size.
- Export draws to an offscreen canvas with the same formulas as the preview (section 6), then shows a preview sheet with the file name `layout-stage-{preset}-{w}x{h}.{ext}`, size, and a Save button.

### Undo and shortcuts

- 80-step undo. A step is saved on drag end, slider release, and every discrete change; nudges save after 350 ms idle.
- ⌘Z undo, ⇧⌘Z or ⌘Y redo, arrows and Shift+arrows nudge, `[` `]` layer order, Esc deselect, Alt while dragging skips snapping, ⌘V pastes an image.

### New: autosave

- The current canvas (images included) saves to IndexedDB after every undo step and restores on reload.
- Saved styles move from localStorage to IndexedDB too.

## New: capture from URL

Paste a URL and the screenshot lands in a layout slot. A headless Chrome on a small server route takes it, because a web page can't screenshot another site on its own. That's also why the prototype doesn't have this: its sandbox blocks requests to other websites.

### What Jesse sees

- A **From URL** button in the Layouts panel, and **Replace from URL** on each layout row. Both open a small capture dialog.
- Dialog fields:
  - URL, with the last 10 captured URLs offered as suggestions so a client site can be re-captured after it changes.
  - Device width: Desktop 1440 (default), Laptop 1280, Tablet 834, Phone 390.
  - Capture: Full page (default) or First screen.
  - Sharpness: 1× or 2× (default 2×, so Etsy's 3000 px canvas stays crisp).
  - Delay before capture: 0 to 5 s, default 1.5 s, for intro animations.
  - Hide cookie banners: on by default.
- While it works, the target slot shows "Capturing…" and the dialog can be closed.
- The result is added exactly like an upload: the name becomes hostname + path, auto-crop applies (a full desktop page gets 16:10), and Scroll picks the section to show.
- Errors say what happened and what to do: "That page didn't finish loading in 30 seconds. Try First screen or a longer delay." / "This site blocks automated browsers. Take a screenshot and drop it in instead." / "Only public web addresses can be captured."

### The server route

`POST /api/capture` with `{ url, width, fullPage, scale, delayMs, hideBanners }`. It returns `image/png`, or JSON `{ code, message }` on failure. It runs on the Node runtime, not Edge.

1. **Check the URL.** Allow `http` and `https` only. Resolve the hostname and refuse private, loopback, link-local and cloud-metadata addresses. Check again after every redirect. This stops the route from being used to reach machines on your own network.
2. **Open a page.** Reuse one browser instance. Create a fresh context per request with viewport `{ width, height: 900 }` and `deviceScaleFactor: scale`. The Phone width also sets a mobile user agent, `isMobile` and `hasTouch`.
3. **Load it.** `goto(url, { waitUntil: 'networkidle', timeout: 30000 })`. If network-idle times out, fall back to the `load` event and carry on.
4. **Hide banners.** When asked, inject one CSS file that hides common consent-banner containers. Keep the selector list in its own file so it's easy to extend.
5. **Wake lazy images.** For Full page, scroll to the bottom in viewport-sized steps, then back to the top, then wait `delayMs`.
6. **Capture.** `screenshot({ fullPage, animations: 'disabled', type: 'png' })`. Cap full-page height at 12,000 CSS px and tell the user when it was trimmed; very tall captures are slow and memory-hungry.
7. **Clean up.** Close the context in a `finally`. Allow one capture at a time per user and queue the rest.

### Where it runs

- **Local first.** `npm run dev` with Playwright's own Chromium (`npx playwright install chromium`). This is the most reliable setup and fits a single-user tool.
- **Hosted later.** Vercel can't run the full browser package because of its function bundle limit; its guide uses `puppeteer-core` with `@sparticuz/chromium-min` instead ([Vercel guide](https://docs.vercel.com/guides/deploying-puppeteer-with-nextjs-on-vercel)). Keep the capture code behind one interface so that swap only touches `lib/capture/server.ts`.
- **Fallback.** A paid screenshot API can sit behind the same route, with its key kept on the server. The client never changes.

### Not in v1

- Pages behind a login or a password. Staging sites with basic auth are a good v2 addition (username and password fields, never stored).
- Capturing several URLs in one go (see batch export in section 9).

## Data model

One `Composition` object holds everything undoable; images live once in IndexedDB and the composition points at them by id, so 80 undo steps don't copy 80 sets of images. Positions are in canvas pixels; frame and background sizes are in units of 1/1000 of the canvas's short side (section 6).

```ts
type PresetId = 'pin' | 'etsy43' | 'etsy11' | 'p45' | 'custom';
type CropId = 'full' | '16:10' | '4:3' | '1:1' | '4:5' | '9:16';
type ShadowPreset = 'none' | 'soft' | 'lifted' | 'float' | 'hard' | 'custom';

interface CaptureOptions {
  width: 1440 | 1280 | 834 | 390;
  fullPage: boolean;
  scale: 1 | 2;
  delayMs: number;        // 0–5000
  hideBanners: boolean;
}

interface Slot {
  imageId: string;        // key into the IndexedDB image store
  name: string;           // file name, or hostname + path for captures
  source:
    | { kind: 'sample' }
    | { kind: 'file' }
    | { kind: 'url'; url: string; capturedAt: string; options: CaptureOptions };
  nw: number; nh: number; // natural size in px
  crop: CropId;
  fx: number; fy: number; // 0–100, visible part when cropped
  cx: number; cy: number; // center, canvas px
  w: number;              // width, canvas px; height = w / cropRatio
}

interface Shadow {
  preset: ShadowPreset;
  blur: number; x: number; y: number; // units
  opacity: number;                    // 0–1
  color: string;                      // #RRGGBB
}

interface Frame { radius: number; borderW: number; borderC: string; shadow: Shadow }

interface Background {
  type: 'solid' | 'gradient' | 'mesh' | 'image';
  solid: string;
  grad: { a: string; b: string; angle: number };  // CSS angle, degrees
  mesh: [string, string, string, string];       // base + 3 glows
  meshSeed: number;
  imageId: string | null;
  imageName: string;
  blur: number;   // units
  dim: number;    // 0–0.7
  grain: number;  // 0–40
}

interface Composition {
  preset: PresetId;
  W: number; H: number;
  count: 1 | 2 | 3;
  slots: [Slot, Slot, Slot]; // only the first `count` are shown
  order: number[];           // z-order bottom → top, all 3 indices
  frame: Frame;
  background: Background;
}

interface Style {
  name: string;
  frame: Frame;
  background: Omit<Background, 'imageId' | 'imageName'>;
}

interface UiState {          // not undoable
  selected: number | null;
  showSafeArea: boolean;
  exportFormat: 'png' | 'jpg';
  exportScale: 1 | 2;
}
```

The prototype stores images as data URLs inside the state. Switch to blobs in IndexedDB with object URLs for display, and revoke an object URL when its image is replaced.

## Rendering rules

The exported file must match the preview exactly, so both read the same formulas from one `lib/render/` module. Every number below comes from `reference/layout-stage.html`.

**Two surfaces, one set of formulas**

- Preview is DOM. A stage `div` at full canvas size is scaled down with `transform: scale(s)`. Each image is a `div` with `overflow: hidden`, `border-radius` and `box-shadow`, holding an `<img>` with `object-fit: cover` and `object-position: fx% fy%`. The background is drawn on a `<canvas>` behind them.
- Export is one offscreen canvas at W·m × H·m (m = 1 or 2): background first, then images in z-order.
- Preview background resolution = scale × devicePixelRatio, capped at 4.5 megapixels.

**Units.** `u = min(W, H) / 1000`. Radius, border, shadow and background blur are all multiplied by `u`, so a style looks the same on a 1000 px pin and a 3000 px Etsy image. Corner radius is clamped to `min(radius·u, w/2, h/2)`.

**Shadow presets**

| Preset | Blur | Drop (y) | Shift (x) | Strength |
| --- | --- | --- | --- | --- |
| None | 0 | 0 | 0 | 0% |
| Soft | 50 | 18 | 0 | 18% |
| Lifted | 80 | 40 | 0 | 28% |
| Float | 140 | 80 | 0 | 38% |
| Hard | 0 | 14 | 14 | 100% |

**Shadow layers.** A shadow draws as a main layer (x, y, blur, opacity) plus, when blur > 0, an ambient layer at (0.2·x, 0.18·y + 1, 0.22·blur + 2, min(1, 0.55·opacity)).

- CSS: a comma list, main layer first, each value × u.
- Canvas: fill the rounded rect in white once per layer with `shadowBlur`, `shadowOffsetX` and `shadowOffsetY` = value × u × m. Canvas shadow settings ignore transforms, so multiply by the export scale yourself.
- CSS blur radius and canvas `shadowBlur` both map to a Gaussian sigma of half the value, so the two match.

**Cover crop** (identical to CSS `object-position` in %):

```text
sc = max(w / nw, h / nh)
sw = w / sc,  sh = h / sc
sx = (nw − sw) · fx / 100,  sy = (nh − sh) · fy / 100
drawImage(img, sx, sy, sw, sh, x, y, w, h)
```

**Border.** CSS draws it on an `::after` layer with `inset: 0` and an inherited radius. Canvas strokes a rect inset by b/2 with radius r − b/2, so the border sits inside the edge in both.

**Gradient angle** (CSS convention, 0° points up): a = angle·π/180, direction (sin a, −cos a), gradient length |W·sin a| + |H·cos a|, centered on the canvas.

**Mesh.** Fill the base color, then draw 3 radial gradients, one per glow color. Each sits in a different quadrant (3 of 4, shuffled by the seed), inset 6 to 44% inside it, with radius 0.62 × the canvas's long side and stops 0 → 100%, 0.45 → 55%, 1 → 0% opacity. Use a seeded xorshift generator so a seed always draws the same mesh.

**Grain.** A 160 px tile of random grey noise, drawn as a pattern scaled by max(0.6, 1.2·k), with `globalCompositeOperation = 'overlay'` and alpha = grain / 100.

**Background image.** Cover-fit. When blurred, scale it up by min(0.3, 3·blur / short side) extra so the edges don't fade. Use `ctx.filter = 'blur()'` when feature detection says it works; otherwise downscale to a small canvas and scale back up.

**Snapping.** Threshold = 7 / scale canvas px. Targets: the canvas center lines plus every other image's left, center and right (top, middle and bottom for y). The dragged image tests its own center and both edges.

## Stack and structure

One Next.js app holds the editor and a single server route. Everything except URL capture runs in the browser.

&#91;embedded content: Layout Stage architecture · browser + one server route\]

The state store is the single source of truth: panels write to it, preview and export read from it, and both draw through the same formulas.

| Piece | Choice | Why |
| --- | --- | --- |
| Framework | Next.js (App Router) + TypeScript | Editor and capture route in one project; easy to deploy later |
| State | Zustand plus a small history layer | Little boilerplate; undo is a stack of `Composition` snapshots |
| Rendering | Canvas 2D in `lib/render/`, no library | The prototype's math already works |
| Storage | IndexedDB through `idb-keyval` | Image blobs, autosave and styles survive reloads |
| Capture | Playwright (Chromium) in a Node route | Full-page screenshots and device sizes |
| Tests | Vitest for the math, Playwright Test for golden exports | Catches preview/export drift early |

```text
app/
  page.tsx                  editor shell
  api/capture/route.ts      POST → PNG (runtime: nodejs)
components/
  TopBar  LayoutsPanel  SelectedPanel  FramePanel
  BackgroundPanel  StylesPanel  Stage  ExportSheet  CaptureDialog
lib/
  model.ts       types, defaults, presets, built-in styles
  samples.ts     the three sample sites, ported from the reference
  arrange.ts     starting positions for 1–3 images
  snap.ts
  history.ts
  store.ts
  images.ts      IndexedDB blob store + object URLs
  render/        units.ts  background.ts  shot.ts  export.ts
  capture/       client.ts  server.ts  url-guard.ts  banners.css
reference/layout-stage.html
docs/HANDOFF.md
CLAUDE.md
```

## Build order

Seven milestones, each ending in something Jesse can open and check against the prototype. Commit after each.

1. **Shell and model.** Next.js app, types, defaults, canvas presets, the six styles, the three sample sites (port the drawing functions from the reference), and the three-column editor with a static stage.
   - Done when the first screen matches the prototype's first screen at 1440 × 900.
2. **Stage interaction.** Selection, drag, corner resize, snapping with guides, nudging, layer order, Center H/V/group, Re-arrange, the 1/2/3 toggle, remove, plus the undo history.
   - Done when every bullet under Layouts in section 3 works and each action undoes in one step.
3. **Frame, background, styles.** All controls in sections 3 and 6, mesh seeding, grain, saved styles.
   - Done when each style, applied in both apps, looks the same side by side.
4. **Images in and autosave.** Upload, drop, paste, replace, auto-crop, crop and scroll; image blobs in IndexedDB; autosave and restore.
   - Done when a reload brings back the exact canvas, images included.
5. **Export.** Offscreen render, preview sheet, PNG/JPG, 1×/2×, file name. Outside the artifact sandbox a normal `<a download>` works.
   - Done when a golden test passes: a fixed composition exports to a PNG that matches a stored reference within a small pixel tolerance, for each preset.
6. **Capture from URL.** Route, URL safety check, dialog, options, errors, recent URLs.
   - Done when a desktop full page and a phone first screen capture cleanly from three real sites, and `http://localhost`, `http://192.168.1.1` and `http://169.254.169.254` are refused with the public-address message.
7. **Polish.** Keyboard shortcuts, light and dark themes, the safe-area overlay, focus states, and the phone layout (canvas first, panels below).
   - Done when a keyboard-only pass can select, move, restyle and export.

## Later

- **Batch export.** Keep the style, feed in several screenshot sets or URLs, export a full Etsy listing set in one go. Likely the biggest time-saver after v1.
- **Headline text** on pins, inside the safe area.
- **Logo watermark** for Etsy previews.
- **Projects library:** named compositions you can reopen and duplicate.
- **Staging sites behind basic auth** for URL capture.
- **Deploy** so it works from any device (see Where it runs, section 4).

## Open questions

- [ ] Run it only on your computer, or deploy it so it works anywhere? This decides how URL capture is hosted.
- [ ] Is 1440 px the right default desktop width for your clients' sites?
- [ ] Should Etsy canvases show the thumbnail crop by default?

## Sources

- [Pinterest pin size (2026), socialk](https://socialk.it/en/sizes/pinterest-pin-size)
- [Etsy listing photo size, Outfy](https://www.outfy.com/blog/etsy-listing-photo-size/)
- [Deploying Puppeteer with Next.js on Vercel](https://docs.vercel.com/guides/deploying-puppeteer-with-nextjs-on-vercel)
