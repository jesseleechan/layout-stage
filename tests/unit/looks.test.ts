/* Texture and the Slate / Concrete / Editorial looks in the model, styles, autosave and store (the
   drawing is in the render-background tests). */
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultComposition } from '@/lib/arrange';
import { applyStyleTo, clone, defaultBackground, defaultUi, STYLES, type Composition } from '@/lib/model';
import { sanitizeComposition } from '@/lib/persist';
import { useEditor } from '@/lib/store';

const S = () => useEditor.getState();

describe('built-in styles', () => {
  it('every built-in names a texture, so applying one clears it', () => {
    for (const st of STYLES) expect(st.background.texture).toBeGreaterThanOrEqual(0);
    expect(STYLES.slice(0, 6).every((st) => st.background.texture === 0)).toBe(true);
  });

  it('ends with Slate, Concrete and Editorial, none with a window bar', () => {
    expect(STYLES.map((s) => s.name).slice(-3)).toEqual(['Slate', 'Concrete', 'Editorial']);
    const by = (n: string) => STYLES.find((s) => s.name === n)!;
    expect(by('Slate').background).toEqual({ type: 'solid', solid: '#B7BCBF', grain: 6, texture: 0 });
    expect(by('Concrete').background).toEqual({ type: 'solid', solid: '#8E8E8C', grain: 34, texture: 70 });
    expect(by('Editorial').frame).toMatchObject({ radius: 10, shadow: { preset: 'lifted', opacity: 0.45 } });
    expect(by('Editorial').background).toMatchObject({ type: 'mesh', meshSeed: 5, grain: 14, texture: 20 });
    for (const st of STYLES) expect('bar' in st.frame).toBe(false);
  });

  it('the default composition has no texture', () => {
    expect(defaultComposition().background.texture).toBe(0);
    expect(defaultBackground().texture).toBe(0);
  });
});

describe('applyStyleTo', () => {
  it('replaces the frame and keeps the current texture when the style doesn’t name one', () => {
    const d = defaultComposition();
    applyStyleTo(d, STYLES.find((s) => s.name === 'Editorial')!);
    expect(d.background.texture).toBe(20);
    applyStyleTo(d, { name: 'My style 1', frame: { radius: 4, borderW: 0, borderC: '#FFFFFF', shadow: clone(d.frame.shadow) }, background: { type: 'solid', solid: '#EEEEEE' } });
    expect(d.frame).toEqual({ radius: 4, borderW: 0, borderC: '#FFFFFF', shadow: d.frame.shadow });
    expect(d.background).toMatchObject({ type: 'solid', solid: '#EEEEEE', texture: 20 });
  });
});

describe('autosave', () => {
  const old = () => {
    const d = clone(defaultComposition()) as unknown as { frame: Record<string, unknown>; background: Record<string, unknown> };
    delete d.background.texture;
    return d;
  };

  it('fills in no texture for a save from before it', () => {
    const out = sanitizeComposition(old())!;
    expect(out.background.texture).toBe(0);
    expect(out).toEqual(defaultComposition());
  });

  it('drops a window bar saved while the option existed', () => {
    const d = old();
    d.frame.bar = 'light';
    expect('bar' in sanitizeComposition(d)!.frame).toBe(false);
  });

  it('clamps the texture to 0–100 and drops anything unusable', () => {
    for (const [v, want] of [[35, 35], [0, 0], [100, 100], [140, 100], [-5, 0], ['abc', 0], [NaN, 0], [Infinity, 0], [null, 0]] as const) {
      const d = old();
      d.background.texture = v;
      expect(sanitizeComposition(d)!.background.texture).toBe(want);
    }
  });
});

describe('store', () => {
  beforeEach(() => {
    S().loadComposition(defaultComposition());
    useEditor.setState({ ui: { ...defaultUi(), selected: null }, toast: null });
  });

  it('texture is a live background edit: no undo step until commit', () => {
    S().editBackground({ texture: 40 });
    S().editBackground({ texture: 55 });
    expect(S().doc.background.texture).toBe(55);
    expect(S().canUndo).toBe(false);
    S().commit();
    S().undo();
    expect(S().doc.background.texture).toBe(0);
  });

  it('saveStyle keeps the texture', async () => {
    S().editBackground({ texture: 33 });
    S().commit();
    await S().saveStyle();
    const st = S().savedStyles.at(-1)!;
    expect(st.background.texture).toBe(33);
    const d: Composition = defaultComposition();
    applyStyleTo(d, st);
    expect(d.background.texture).toBe(33);
  });
});
