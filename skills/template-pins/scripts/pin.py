#!/usr/bin/env python3
"""Lays out a template pin and writes its Claude Design artboard (.dc.html).

Same geometry and looks as the Layout Stage app (lib/arrange.ts, lib/model.ts, lib/render/), so the
outputs can be compared pixel for pixel. Pure Python, no packages.

  python3 pin.py spec.json out-dir/

spec.json:
  {
    "tiles": {"texture-70": "/_blob/<id>", "grain-34": "/_blob/<id>", ...},   # uploaded tile urls
    "pins": [
      {
        "file": "Main",                      # artboard file name, without .dc.html
        "title": "Scroll · Pinterest pin",
        "size": "pin",                       # pin | etsy43 | etsy11 | portrait, or [W, H]
        "layout": "scroll",                  # scroll (1 page) | columns (1 or 2) | editorial (3)
        "look": "concrete",                  # concrete | slate | editorial
        "pages": [{"src": "/_blob/<id>", "w": 1440, "h": 4161, "alt": "Hester home page"}]
      }
    ]
  }

columns with ONE page continues that page from the first column into the second when it is long
enough (see SKILL.md). Prints each artboard's frames and a canvas.json "boards" entry.
"""
import json
import os
import sys

SIZES = {'pin': (1000, 1500), 'etsy43': (3000, 2250), 'etsy11': (2000, 2000), 'portrait': (1080, 1350)}

SCROLL = {'port': dict(w=0.8, phoneW=0.46, top=0.115), 'sq': dict(w=0.74, phoneW=0.4, top=0.11),
          'land': dict(w=0.62, phoneW=0.3, top=0.11)}
COLUMNS = {'port': dict(m=0.1, g=0.05, top=0.067, stagger=0.08), 'sq': dict(m=0.11, g=0.05, top=0.1, stagger=0.09),
           'land': dict(m=0.17, g=0.045, top=0.1, stagger=0.1)}
EDITORIAL = {'port': dict(w=0.46, top=0.16, sideW=0.34, side=0.05, drop=0.065),
             'sq': dict(w=0.42, top=0.15, sideW=0.32, side=0.06, drop=0.07),
             'land': dict(w=0.38, top=0.14, sideW=0.3, side=0.08, drop=0.08)}

LOOKS = {
    'slate': dict(radius=0, bar=None, shadow=dict(blur=40, x=0, y=16, opacity=0.16, color='#26313A'),
                  solid='#B7BCBF', texture=0, grain=6),
    'concrete': dict(radius=0, bar=None, shadow=dict(blur=60, x=0, y=24, opacity=0.3, color='#1A1A1A'),
                     solid='#8E8E8C', texture=70, grain=34),
    'editorial': dict(radius=10, bar='light', shadow=dict(blur=80, x=0, y=40, opacity=0.45, color='#120D09'),
                      mesh=['#3A342E', '#5C5046', '#2B2521', '#4B4038'],
                      points=[(0.4395, 0.3558), (0.1110, 0.7084), (0.7420, 0.4013)], texture=20, grain=14),
}
BAR = dict(bar='#F3F2EF', line='#E2E0DB', field='#E4E2DD', dots=['#FF5F57', '#FEBC2E', '#28C840'])


def kind(W, H):
    ar = W / H
    return 'land' if ar > 1.1 else 'sq' if ar > 0.9 else 'port'


def r2(v):
    v = round(v, 2)
    return int(v) if v == int(v) else v


def rgba(hex_, a):
    n = int(hex_[1:], 16)
    return f'rgba({n >> 16 & 255},{n >> 8 & 255},{n & 255},{a:.3f})'


def place(W, H, layout, pages):
    """Frames as dicts {page, l, t, w, h} in canvas px, back to front."""
    k = kind(W, H)

    def at(p, cx, top, w):
        return dict(page=p, l=cx - w / 2, t=top, w=w, h=w * p['h'] / p['w'])

    if layout == 'scroll':
        P, p = SCROLL[k], pages[0]
        s = [at(p, W / 2, P['top'] * H, (P['phoneW'] if p['w'] <= 500 else P['w']) * W)]
    elif layout == 'columns':
        P = COLUMNS[k]
        w = W * (1 - 2 * P['m'] - P['g']) / 2
        xa, xb, top = W * P['m'] + w / 2, W - W * P['m'] - w / 2, P['top'] * H
        a, b = (pages[0], pages[0]) if len(pages) == 1 else pages[:2]
        ha = w * a['h'] / a['w']
        if len(pages) == 1 and ha > H - top:
            L = min(H - top, ha / 2)  # one long page: column 1 shows its first L px, column 2 the next
            s = [at(a, xa, H - L, w), at(a, xb, -L, w)]
        else:
            s = [at(a, xa, top, w), at(b, xb, top + P['stagger'] * H, w)]
    elif layout == 'editorial':
        P = EDITORIAL[k]
        top, sw = P['top'] * H, P['sideW'] * W
        s = [at(pages[0], W / 2, top, P['w'] * W),
             at(pages[1], P['side'] * W + sw / 2, top + P['drop'] * H, sw),
             at(pages[2], W - P['side'] * W - sw / 2, top + P['drop'] * H, sw)]
    else:
        raise SystemExit(f'unknown layout {layout!r}')
    t0 = min(q['t'] for q in s)
    b0 = max(q['t'] + q['h'] for q in s)
    if t0 >= 0 and b0 <= H:  # nothing runs off: center the group vertically
        dy = (H - (b0 - t0)) / 2 - t0
        for q in s:
            q['t'] += dy
    return [s[1], s[2], s[0]] if layout == 'editorial' else s  # the hero in front


def shadow_css(sh, u):
    main = f"{r2(sh['x'] * u)}px {r2(sh['y'] * u)}px {r2(sh['blur'] * u)}px {rgba(sh['color'], sh['opacity'])}"
    amb = (f"{r2(sh['x'] * 0.2 * u)}px {r2((sh['y'] * 0.18 + 1) * u)}px {r2((sh['blur'] * 0.22 + 2) * u)}px "
           f"{rgba(sh['color'], min(1, sh['opacity'] * 0.55))}")
    return f'{main}, {amb}'


def frame_html(q, look, u):
    L = look
    box = (f"position: absolute; left: {r2(q['l'])}px; top: {r2(q['t'])}px; width: {r2(q['w'])}px; "
           f"height: {r2(q['h'])}px; border-radius: {r2(L['radius'] * u)}px; overflow: hidden; background: #FFFFFF; "
           f"box-shadow: {shadow_css(L['shadow'], u)}")
    p = q['page']
    if not L['bar']:
        return (f'<div style="{box}"><img src="{p["src"]}" alt="{p["alt"]}" '
                f'style="display: block; width: 100%; height: auto"></div>')
    w = q['w']
    h = w * 0.036
    line_h, dot_r, fw, fh = h * 0.045, h * 0.135, w * 0.42, h * 0.5
    dots = ''.join(
        f'<div style="position: absolute; left: {r2(h * 0.62 + j * h * 0.44 - dot_r)}px; top: {r2(h / 2 - dot_r)}px; '
        f'width: {r2(dot_r * 2)}px; height: {r2(dot_r * 2)}px; border-radius: 50%; background: {c}"></div>'
        for j, c in enumerate(BAR['dots']))
    bar = (f'<div style="position: absolute; left: 0px; top: 0px; width: 100%; height: {r2(h)}px; background: {BAR["bar"]}">'
           f'{dots}'
           f'<div style="position: absolute; left: 0px; top: {r2(h - line_h)}px; width: 100%; height: {r2(line_h)}px; '
           f'background: {BAR["line"]}"></div>'
           f'<div style="position: absolute; left: {r2((w - fw) / 2)}px; top: {r2(h / 2 - fh / 2)}px; width: {r2(fw)}px; '
           f'height: {r2(fh)}px; border-radius: {r2(fh / 2)}px; background: {BAR["field"]}"></div></div>')
    return (f'<div style="{box}"><img src="{p["src"]}" alt="{p["alt"]}" style="position: absolute; left: 0px; '
            f'top: {r2(h)}px; display: block; width: 100%; height: auto">{bar}</div>')


def artboard(pin, tiles):
    W, H = SIZES[pin['size']] if isinstance(pin['size'], str) else pin['size']
    L = LOOKS[pin['look']]
    u = min(W, H) / 1000
    if 'solid' in L:
        bg = f"background: {L['solid']}"
    else:
        R = max(W, H) * 0.62
        layers = [f"radial-gradient(circle {r2(R)}px at {r2(px * W)}px {r2(py * H)}px, {rgba(c, 1)} 0px, "
                  f"{rgba(c, 0.55)} {r2(R * 0.45)}px, {rgba(c, 0)} {r2(R)}px)"
                  for (px, py), c in zip(L['points'], L['mesh'][1:])]
        bg = f"background: {', '.join(reversed(layers))}, {L['mesh'][0]}"
    side = max(W, H)
    frames = place(W, H, pin['layout'], pin['pages'])
    css = ['body{margin:0}']
    layers = ''
    if L['texture']:
        css.append(f".tex{{position:absolute;left:{r2((W - side) / 2)}px;top:{r2((H - side) / 2)}px;width:{side}px;"
                   f"height:{side}px;background-image:url({tiles['texture-%d' % L['texture']]});background-size:100% 100%;"
                   f"mix-blend-mode:soft-light}}")
        layers += '<div class="tex"></div>'
    if L['grain']:
        css.append(f".grain{{position:absolute;left:0;top:0;width:100%;height:100%;background-image:url("
                   f"{tiles['grain-%d' % L['grain']]});background-size:192px 192px;background-position:0 0;"
                   f"mix-blend-mode:overlay}}")
        layers += '<div class="grain"></div>'
    body = '\n'.join([
        f'<div style="position: relative; width: {W}px; height: {H}px; overflow: hidden; isolation: isolate; {bg}">',
        layers, *[frame_html(q, L, u) for q in frames], '</div>'])
    nl = '\n'
    html = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{pin['title']}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>
{nl.join(css)}
</style>
</helmet>
{body}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":{W},"height":{H}}}}}'>
class Component extends DCLogic {{
renderVals() {{
return {{}};
}}
}}
</script>
</body>
</html>
'''
    return W, H, frames, html


def main():
    spec = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    os.makedirs(out, exist_ok=True)
    for pin in spec['pins']:
        W, H, frames, html = artboard(pin, spec.get('tiles', {}))
        name = pin['file'] + '.dc.html'
        with open(os.path.join(out, name), 'w') as f:
            f.write(html)
        print(f"{name}: {W}x{H}, {pin['layout']} / {pin['look']}")
        for q in frames:
            print(f"  {q['page']['alt']}: left {r2(q['l'])}, top {r2(q['t'])}, width {r2(q['w'])}, height {r2(q['h'])}")


if __name__ == '__main__':
    main()
