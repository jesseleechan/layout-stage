/* The scrolling video: one layout's page scrolls inside its frame (or, shown whole and running off the
   canvas, slides up through it) while everything else stays put.
   Every frame is drawn by the shared renderers (drawBackground, drawLayouts, drawOverlays), so a frame
   is the still export at that scroll position. The background never changes, so it is drawn once to
   its own canvas and copied under each frame. Frames are encoded to H.264 with WebCodecs, faster than
   real time and with exact timing, and written to an MP4 by lib/video/mp4.ts. Browser only. */
import type { Composition } from '../model';
import { loadImage } from '../images';
import { anyOverlay, overlaysOf } from '../overlays';
import { drawBackground, makeCanvas } from '../render/background';
import { drawLayouts } from '../render/export';
import { drawOverlays } from '../render/overlays';
import { loadOverlayFonts } from '../render/overlay-fonts';
import { annexBToAvcc, avcCFrom, colorFrom, muxMp4, type Mp4Sample } from './mp4';
import { avcCodecs, framePlanFor, isKeyFrame, slotAtFrame, VIDEO_FPS, videoBitrate, videoFileName, videoSize, type VideoSettings } from './timing';

export interface VideoResult {
  blob: Blob;
  w: number;
  h: number;
  frames: number;
  seconds: number;
  name: string;
  codec: string;
}

/** Thrown when this browser can't encode H.264 video. */
export class VideoUnsupportedError extends Error {
  constructor() {
    super('video unsupported');
    this.name = 'VideoUnsupportedError';
  }
}

/** Whether the browser has WebCodecs video encoding at all (Chrome, Edge, Safari 16.4+, Firefox 130+). */
export function hasVideoEncoder(): boolean {
  return typeof window !== 'undefined' && typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/** The first H.264 encoder setup this browser takes for a w × h video, or null. */
export async function findEncoderConfig(w: number, h: number, fps = VIDEO_FPS): Promise<VideoEncoderConfig | null> {
  if (!hasVideoEncoder()) return null;
  for (const codec of avcCodecs(w, h, fps)) {
    const config: VideoEncoderConfig = { codec, width: w, height: h, bitrate: videoBitrate(w, h, fps), framerate: fps, avc: { format: 'avc' } };
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
    } catch {
      /* not this one: try the next */
    }
  }
  return null;
}

/** A copy of the encoder's decoder setup bytes. */
const toBytes = (d: AllowSharedBufferSource) =>
  ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength).slice() : new Uint8Array(d).slice();

const aborted = () => new DOMException('Cancelled', 'AbortError');

/* Waiting without timers: a tab in the background runs setTimeout at most once a second, which would
   stretch a 15-second render to minutes when the user looks at another tab meanwhile. */

/** The next task: lets the page handle input and paint. */
const nextTask = () =>
  new Promise<void>((res) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); res(); };
    ch.port2.postMessage(0);
  });

/** Until the encoder takes the next frame off its queue (or briefly, where there's no dequeue event). */
const dequeued = (enc: VideoEncoder) =>
  new Promise<void>((res) => {
    const done = () => { enc.removeEventListener('dequeue', done); clearTimeout(t); res(); };
    const t = setTimeout(done, 'ondequeue' in enc ? 250 : 2);
    enc.addEventListener('dequeue', done);
  });

export interface RenderVideoOptions {
  /** Frames drawn so far, of `total`. */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/** Renders and encodes the scrolling video of `doc` (not changed). Rejects with an AbortError when
 *  cancelled and VideoUnsupportedError when the browser can't encode H.264. */
export async function renderScrollVideo(doc: Composition, settings: VideoSettings, opts: RenderVideoOptions = {}): Promise<VideoResult> {
  const { signal, onProgress } = opts;
  const fps = VIDEO_FPS;
  const { w, h, m } = videoSize(doc.W, doc.H, settings.long);
  const config = await findEncoderConfig(w, h, fps);
  if (!config) throw new VideoUnsupportedError();
  if (signal?.aborted) throw aborted();

  // Everything the frames draw, loaded once.
  const wm = overlaysOf(doc).watermark;
  const [imgs, bgImg, logo] = await Promise.all([
    Promise.all(doc.slots.slice(0, doc.count).map((s) => loadImage(s.imageId))),
    doc.background.type === 'image' ? loadImage(doc.background.imageId) : Promise.resolve(null),
    anyOverlay(doc) && wm.enabled && wm.kind === 'logo' ? loadImage(wm.imageId) : Promise.resolve(null),
    loadOverlayFonts(doc),
  ]);
  await Promise.all(imgs.map((img) => img?.decode().catch(() => undefined)));
  if (signal?.aborted) throw aborted();

  const [bg, bx] = makeCanvas(w, h);
  drawBackground(bx, doc.background, doc.W, doc.H, m, bgImg);
  const [c, x] = makeCanvas(w, h);
  x.imageSmoothingQuality = 'high';

  const plan = framePlanFor(doc.slots[settings.slot], settings, fps, doc.H);
  const frameDuration = 1000; // media timescale fps × 1000: every frame lasts exactly 1000 units
  const us = (i: number) => Math.round((i * 1e6) / fps);
  // Written by the encoder's callbacks.
  const out = {
    samples: [] as Mp4Sample[],
    avcC: null as Uint8Array | null,
    colorSpace: undefined as VideoColorSpaceInit | undefined,
    failure: null as unknown,
    /** The encoder gave no decoder setup, so its frames are Annex B: converted here. */
    annexB: false,
  };
  const encoder = new VideoEncoder({
    output(chunk, meta) {
      const cfg = meta?.decoderConfig;
      if (cfg && !out.avcC && !out.annexB) {
        if (cfg.description) out.avcC = toBytes(cfg.description);
        else out.annexB = true;
        out.colorSpace = cfg.colorSpace;
      }
      let data: Uint8Array = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      if (out.annexB) {
        const f = annexBToAvcc(data);
        data = f.data;
        if (!out.avcC && f.sps.length && f.pps.length) out.avcC = avcCFrom(f.sps, f.pps);
      }
      out.samples.push({ data, key: chunk.type === 'key', pts: Math.round((chunk.timestamp * fps) / 1e6) * frameDuration });
    },
    error(e) {
      out.failure = e;
    },
  });

  try {
    encoder.configure(config);
    let lastYield = performance.now();
    for (let i = 0; i < plan.frames; i++) {
      if (signal?.aborted) throw aborted();
      if (out.failure) throw out.failure;
      const d: Composition = { ...doc, slots: doc.slots.map((s, k) => (k === settings.slot ? slotAtFrame(s, plan, i, doc.H) : s)) as Composition['slots'] };
      x.clearRect(0, 0, w, h);
      x.drawImage(bg, 0, 0);
      drawLayouts(x, d, m, imgs);
      drawOverlays(x, d, m, { logo });
      const frame = new VideoFrame(c, { timestamp: us(i), duration: us(i + 1) - us(i), alpha: 'discard' });
      encoder.encode(frame, { keyFrame: isKeyFrame(i, fps) });
      frame.close();
      onProgress?.(i + 1, plan.frames);
      // Keep a few frames in flight, and let the page paint now and then.
      while (encoder.encodeQueueSize > 2 && !out.failure && !signal?.aborted) await dequeued(encoder);
      if (performance.now() - lastYield > 40) {
        await nextTask();
        lastYield = performance.now();
      }
    }
    await encoder.flush();
    if (out.failure) throw out.failure;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    c.width = c.height = bg.width = bg.height = 0;
  }
  if (signal?.aborted) throw aborted();
  if (!out.avcC) throw new Error('the encoder gave no decoder setup');
  if (out.samples.length !== plan.frames) throw new Error(`encoded ${out.samples.length} of ${plan.frames} frames`);

  const parts = muxMp4(out.samples, { width: w, height: h, timescale: fps * frameDuration, frameDuration, avcC: out.avcC, color: colorFrom(out.colorSpace) });
  return {
    blob: new Blob(parts as BlobPart[], { type: 'video/mp4' }),
    w, h, frames: plan.frames, seconds: plan.frames / fps,
    name: videoFileName(doc, w, h, 'mp4'),
    codec: String(config.codec),
  };
}
