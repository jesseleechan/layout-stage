---
name: template-pins
description: Turn 1–3 website screenshots (or URLs to capture) into a Pinterest pin, Etsy listing image or 4:5 portrait on a Claude Design canvas, in the Layout Stage app's three looks (Scroll on Concrete, Columns on Slate, Editorial browser windows), with whole pages running off the canvas. Use when someone wants a pin, Etsy listing image or social image showing a website template, Squarespace or otherwise, from screenshots or URLs.
---

# Template pins on a Claude Design canvas

Lay out 1–3 full-page website screenshots on a fixed-size artboard, the way the Layout Stage app's
"showcase" arrangements do. The numbers below are the app's (`lib/arrange.ts`, `lib/model.ts`,
`lib/render/`), so a pin made here and one exported from the app match to within a pixel.

The fast, exact path is `scripts/pin.py`: it does all the math below and writes each artboard's
`.dc.html`. The rest of this file is what it does, so you can check it, tweak it, or work without it.

## 1. Inputs

- **Pages.** Full-page screenshots, 1440 px wide, the whole page top to bottom. Given URLs, capture
  them (section 7). Never crop a page to the screen: these layouts show it whole and let it run off.
- **Canvas** (ask if not said; a Pinterest pin is the default):

  | size | canvas (CSS px) | export | file |
  |---|---|---|---|
  | `pin` Pinterest pin, 2:3 | 1000 × 1500 | 2× | 2000 × 3000 |
  | `etsy43` Etsy listing, 4:3 | 3000 × 2250 | 1× | 3000 × 2250 |
  | `etsy11` Etsy listing, square | 2000 × 2000 | 1× | 2000 × 2000 |
  | `portrait` 4:5 | 1080 × 1350 | 2× | 2160 × 2700 |

- **Layout** follows the number of pages: 1 → Scroll, 2 → Columns, 3 → Editorial. One long page can
  also fill Columns (section 3).
- **Look**: by default Scroll → Concrete, Columns → Slate, Editorial → Editorial. Any look works with
  any layout.

## 2. Units

- Positions and sizes are canvas px (the artboard's CSS px). `W`, `H` = canvas size.
- **u** = 1/1000 of the canvas's short side: `u = min(W, H) / 1000`. Radius and shadow are in u.
- **Canvas kind**: `W/H > 1.1` → landscape; `> 0.9` → square; else portrait. Pin and portrait
  are portrait, `etsy11` square, `etsy43` landscape.
- A page's height on the canvas is `w × page_h / page_w` (shown whole, never cropped).
- In the tables, widths and side distances are fractions of `W`; tops, drops and staggers are
  fractions of `H`.

## 3. The three layouts

### Scroll (1 page)

| kind | width | top |
|---|---|---|
| portrait | 0.80 | 0.115 |
| square | 0.74 | 0.11 |
| landscape | 0.62 | 0.11 |

Centered horizontally, top edge at `top × H`. A phone capture (390 px wide) uses width 0.46 /
0.40 / 0.30 instead.

### Columns (2 pages, or 1 long page)

| kind | side margin `m` | gap `g` | first top | second starts lower by |
|---|---|---|---|---|
| portrait | 0.10 | 0.05 | 0.067 | 0.08 |
| square | 0.11 | 0.05 | 0.10 | 0.09 |
| landscape | 0.17 | 0.045 | 0.10 | 0.10 |

Column width `w = W × (1 − 2m − g) / 2`. Left column's left edge `m × W`; right column's right edge
`W − m × W`. First column's top `top × H`; the second's `(top + stagger) × H`.

**One long page across two columns.** With one page in Columns, whose height `ha` at column width
is more than the room below the first top (`ha > H − top×H`), show it as one continuous page:
`L = min(H − top×H, ha / 2)`; the first column's top is `H − L` (it shows the page's first `L` px and
runs off the bottom); the second column's top is `−L` (it runs off the top, and its first visible
pixel is the page's pixel `L`, where column one left off). Both use the same image.
A page that isn't longer than that room is shown in both columns in the normal staggered spots.

### Editorial (3 pages)

| kind | hero width | hero top | side width | side inset | sides lower by |
|---|---|---|---|---|---|
| portrait | 0.46 | 0.16 | 0.34 | 0.05 | 0.065 |
| square | 0.42 | 0.15 | 0.32 | 0.06 | 0.07 |
| landscape | 0.38 | 0.14 | 0.30 | 0.08 | 0.08 |

Page 1 is the hero, centered. Page 2 sits at the left (left edge `side × W`), page 3 at the right
(right edge `W − side × W`), both with top `(hero top + drop) × H`. **Paint order**: the two side
windows first, the hero last (in front).

### Pages too short to run off

After placing, if every frame is inside the canvas (no top above 0, no bottom below `H`), move the
whole group vertically so it is centered: shift every top by `(H − (bottom − top)) / 2 − top`,
where top and bottom are the group's. Otherwise leave it: pages run off the bottom (and in the
one-page Columns, off the top).

### Room for a headline (later)

Headlines are not part of this skill yet. The layouts already leave the top 6.7–16 % free. When a
headline is added, keep the same proportions but start the layouts below the headline's block plus
`40 u`.

## 4. The three looks

| look | background | grain | texture | radius | window bar | shadow (blur, x, y, opacity, color) |
|---|---|---|---|---|---|---|
| **Concrete** | solid `#8E8E8C` | 34 | 70 | 0 | none | 60, 0, 24, 0.30, `#1A1A1A` |
| **Slate** | solid `#B7BCBF` | 6 | 0 | 0 | none | 40, 0, 16, 0.16, `#26313A` |
| **Editorial** | mesh `#3A342E` + `#5C5046`, `#2B2521`, `#4B4038` (seed 5) | 14 | 20 | 10 | light | 80, 0, 40, 0.45, `#120D09` |

### Frame (every page)

A box at the page's rect, `overflow: hidden`, white behind the image,
`border-radius: radius × u`, and two box-shadows (main, then ambient), all lengths × u:

```
box-shadow: {x}px {y}px {blur}px rgba(color, opacity),
            {0.2·x}px {0.18·y + 1}px {0.22·blur + 2}px rgba(color, min(1, 0.55·opacity))
```

On a 1000-wide pin (u = 1): Concrete `0 24px 60px rgba(26,26,26,.3), 0 5.32px 15.2px rgba(26,26,26,.165)`;
Slate `0 16px 40px rgba(38,49,58,.16), 0 3.88px 10.8px rgba(38,49,58,.088)`;
Editorial `0 40px 80px rgba(18,13,9,.45), 0 8.2px 19.6px rgba(18,13,9,.2475)`.

The image fills the box's width (`width: 100%; height: auto`), top-aligned; anything below the box
is clipped.

### Window bar (Editorial; light)

Inside the top of the frame, for a frame of width `w`:

- bar: height `h = 0.036 w`, full width, `#F3F2EF`
- separator: height `0.045 h` along the bar's bottom edge, `#E2E0DB`
- three dots `#FF5F57`, `#FEBC2E`, `#28C840`: radius `0.135 h`, centers at `x = 0.62 h + j × 0.44 h`
  (j = 0, 1, 2), `y = h / 2`
- address field: `0.42 w × 0.5 h`, centered in the bar, fully rounded, `#E4E2DD`
- the page image starts below the bar (`top: h`), full width; the frame keeps its height, so the
  page's bottom `h` px are clipped.

(A dark bar, should one be wanted: `#2B2A2D`, separator `#1D1C1F`, field `#3D3C40`.)

### Background

Painted in this order, all under the frames:

1. **Base.** Solid: the color. Mesh: the first color, then three radial glows. Glow i uses color
   i+1, centered at these fractions of (W, H) for seed 5: (0.4395, 0.3558), (0.1110, 0.7084),
   (0.7420, 0.4013). Radius `R = 0.62 × max(W, H)`; stops: color at 0, 55 % alpha at `0.45 R`,
   transparent at `R`. In CSS the later glow is the earlier layer:
   `background: glow3, glow2, glow1, base`, each
   `radial-gradient(circle Rpx at Xpx Ypx, c 0px, c@.55 0.45Rpx, c@0 Rpx)`.
2. **Texture** (Concrete, Editorial): `assets/texture-<amount>.png`, a 256 px tile of soft
   plaster clouds, stretched to one square of side `max(W, H)` centered on the canvas,
   `mix-blend-mode: soft-light`.
3. **Grain**: `assets/grain-<amount>.png`, a 160 px noise tile repeated at `192px × 192px` from the
   canvas's top-left, `mix-blend-mode: overlay`.

The tiles already carry their opacity (texture 70 and 20, grain 34, 14 and 6). Soft-light and
overlay are linear in the top layer, so a tile baked as `127.5 + a × (v − 127.5)` at full opacity
draws exactly what the raw tile does at opacity `a`. For another amount, bake it from
`texture-raw.png` / `grain-raw.png` the same way.

Put `isolation: isolate` on the artboard's root (so the blends only see the background) and nothing
on the layers' parents: an isolated wrapper around the texture or grain layer makes it paint as
flat grey.

## 5. Build it in Claude Design

1. **Upload the images** to the canvas as assets: each page screenshot, plus the tiles the looks use
   (`texture-70`, `grain-34` for Concrete; `grain-6` for Slate; `texture-20`, `grain-14` for
   Editorial). Use the `/_blob/<id>` urls verbatim. A screenshot over ~10 MB as PNG can go up as
   a JPEG at quality 90.
2. **One artboard per pin**, fixed at `W × H` (the canvas size in CSS px, not the export size),
   `$preview` the same. Root:
   `<div style="position: relative; width: Wpx; height: Hpx; overflow: hidden; isolation: isolate; background: …">`,
   then the texture and grain layers, then the frames in paint order, each
   `position: absolute` with `left`, `top`, `width`, `height` in px (2 decimals are plenty).
   Tile urls go in the `<helmet><style>` (`.tex`, `.grain` classes), never in inline styles.
3. With `scripts/pin.py`: write a spec (the file's docstring shows the shape) with the tile urls and
   each pin's size, layout, look and pages (`src`, pixel `w` and `h`, `alt`), run
   `python3 scripts/pin.py spec.json project/`, and publish the `.dc.html` files plus a
   `canvas.json` whose `boards` give each artboard its `W × H` (80 px apart in a row).
4. Name the frames in your reply by template, not by number.

Everything stays editable on the canvas: drag a page, change its width or top in the properties
panel, retype a color. A moved page is no longer the app's spot, which is fine; to go back,
re-run the script.

## 6. Export

Select the artboard → Export → PNG, Scale **2×** for `pin` and `portrait` (2000 × 3000,
2160 × 2700) and **1×** for Etsy (3000 × 2250, 2000 × 2000). Claude Design exports PNG or JPEG at
0.5×, 1×, 2× or 4×, up to 12,000 px on the long side.

Etsy shows thumbnails cropped to 5:4 in the center: on `etsy43` that is the middle 2812.5 × 2250
(a 93.75 px strip off each side), on `etsy11` the middle 2000 × 1600. Keep what matters inside.

## 7. Capturing URLs

Capture at 1440 px wide, full page, after the page settles, with cookie banners hidden. With
Playwright (Python):

```python
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(url, wait_until="load")  # not "networkidle": analytics keep many sites busy
    # Load lazy images before the full-page shot.
    pg.evaluate("""async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) {
        window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } window.scrollTo(0, 0); }""")
    pg.wait_for_timeout(1500)
    pg.screenshot(path="page.png", full_page=True)
```

Look at every capture before using it. Sections with a fixed (parallax) background image can come out
as blank bands in a full-page screenshot; Squarespace's Brine demo does. Template demo sites
(`*-demo.squarespace.com`) also show a "Create a site like this" badge at the bottom right of the
first screen; capture your own site instead, or hide the badge. The Layout Stage app's capture
(`lib/capture/`) hides cookie banners and joins very tall pages from slices; use it when it is
running.

## 8. Check before handing over

- Every frame's left, top and width match the tables (within 1 px).
- Long pages run off the bottom; the one-page Columns' second column runs off the top and picks
  up where the first leaves off.
- The editorial hero is in front of the side windows.
- The background shows texture and grain, not flat grey: if it is flat grey, a layer's parent is
  isolated (section 4).
