'use client';
/* Feed preview: the image at the size people first see it, among placeholders. Pinterest's desktop
   feed shows pins 236 px wide; Etsy's search shows a listing's first photo cropped to 5:4 (the
   thumbnail the Etsy safe area marks). Each shows the canvas when it is that kind of canvas, else the
   layouts re-laid for it as Export all sizes makes them (a 2:3 pin, an Etsy 4:3 photo). Drawn with
   the export renderer, so it is the real image, just small: a check that the pages still read. */
import { useEffect, useState } from 'react';
import { useEditor } from '@/lib/store';
import { clone, PRESETS, type Composition } from '@/lib/model';
import { forPreset } from '@/lib/sets';
import { renderComposition } from '@/lib/render/export';
import { Seg, type Option } from './controls';

type Where = 'pinterest' | 'etsy';
const WHERE: Option<Where>[] = [
  { value: 'pinterest', label: 'Pinterest feed' },
  { value: 'etsy', label: 'Etsy search' },
];

/** Pinterest's desktop feed column width, and Etsy's search card width, in CSS px. */
export const PIN_FEED_WIDTH = 236;
export const ETSY_CARD_WIDTH = 220;

/** Placeholder pin heights (× the column width), so the feed looks like a feed. */
const PIN_HEIGHTS = [1.25, 1.62, 1.1, 1.48, 1.85, 1.3, 1.5, 1.15, 1.7, 1.38, 1.22, 1.55];

const isEtsy = (d: Composition) => d.preset === 'etsy43' || d.preset === 'etsy11';

export default function FeedBody({ onClose }: { onClose: () => void }) {
  const [where, setWhere] = useState<Where>('pinterest');
  // What each place shows: the canvas, or the layouts re-laid for it.
  const [docs] = useState(() => {
    const d = clone(useEditor.getState().doc);
    return { etsyCanvas: isEtsy(d), pinterest: isEtsy(d) ? forPreset(d, 'pin') : d, etsy: isEtsy(d) ? d : forPreset(d, 'etsy43') };
  });
  const [urls, setUrls] = useState<Partial<Record<Where, string>>>({});

  // Each image once, at twice its width on the page (sharp on high-density screens).
  useEffect(() => {
    let on = true;
    for (const w of ['pinterest', 'etsy'] as const) {
      const d = docs[w];
      // An Etsy photo is cropped to the 5:4 card, so it's drawn a little wider than the card.
      const width = w === 'pinterest' ? PIN_FEED_WIDTH : ETSY_CARD_WIDTH * 1.4;
      void renderComposition(d, (width * 2) / d.W).then(
        (c) => { if (on) setUrls((u) => ({ ...u, [w]: c.toDataURL('image/jpeg', 0.9) })); },
        () => undefined,
      );
    }
    return () => { on = false; };
  }, [docs]);

  const url = urls[where] ?? null;
  const pin = docs.pinterest;
  const pinH = Math.round((PIN_FEED_WIDTH * pin.H) / pin.W);
  return (
    <>
      <p className="fine">Your image at the size people first see it. Check that the pages still read and nothing important sits at the edges.</p>
      <Seg label="Where" options={WHERE} value={where} onPick={setWhere} />
      {where === 'pinterest' ? (
        <div className="feed feed-pins" aria-label="Pinterest feed preview">
          {[0, 1, 2, 3].map((col) => (
            <div className="feed-col" key={col}>
              {PIN_HEIGHTS.slice(col * 3, col * 3 + 3).map((k, j) =>
                col === 1 && j === 0 ? (
                  <figure className="feed-pin mine" key="mine" style={{ height: pinH }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {url ? <img src={url} alt="Your pin at feed size" id="feedPin" /> : null}
                  </figure>
                ) : (
                  <span className="feed-pin" key={j} style={{ height: Math.round(PIN_FEED_WIDTH * k) }} aria-hidden="true" />
                ),
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="feed feed-etsy" aria-label="Etsy search preview">
          {Array.from({ length: 8 }, (_, k) => (
            <div className="feed-card" key={k}>
              {k === 0 ? (
                <figure className="feed-thumb mine">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {url ? <img src={url} alt="Your listing photo as a search thumbnail" id="feedEtsy" /> : null}
                </figure>
              ) : (
                <span className="feed-thumb" aria-hidden="true" />
              )}
              <span className="feed-line" aria-hidden="true" />
              <span className="feed-line short" aria-hidden="true" />
            </div>
          ))}
        </div>
      )}
      <p className="fine" id="feedNote">
        {where === 'pinterest'
          ? `Pins show ${PIN_FEED_WIDTH} px wide in Pinterest’s desktop feed; yours is ${PIN_FEED_WIDTH} × ${pinH} there.${docs.etsyCanvas ? ` These are your layouts as a ${PRESETS.pin.label}, as Export all sizes makes it.` : ''}`
          : `Etsy search crops the first photo to 5:4 around its middle (the Etsy safe area on the canvas shows it).${docs.etsyCanvas ? '' : ` These are your layouts as an ${PRESETS.etsy43.label} photo, as Export all sizes makes it.`}`}
      </p>
      <div className="sheet-actions">
        <button className="btn primary" id="sheetBack" type="button" onClick={onClose}>Back to editing</button>
      </div>
    </>
  );
}
