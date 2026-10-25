/* The three sample sites, drawn on a canvas (not loaded). Ported from reference/layout-stage.html.
   TODO(samples agent): replace the placeholder below with the full port of siteJuniper,
   siteNorthbeam and siteFieldnote. */
import { SAMPLE_H, SAMPLE_IDS, SAMPLE_W } from './model';

export type SampleId = (typeof SAMPLE_IDS)[number];

/** Draws the sample site at full size (1440 × 2560). Browser only. */
export function drawSample(id: SampleId): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = SAMPLE_W;
  c.height = SAMPLE_H;
  const x = c.getContext('2d')!;
  x.fillStyle = id === 'sample:northbeam' ? '#0E141B' : id === 'sample:fieldnote' ? '#FFF3E6' : '#FFF7F4';
  x.fillRect(0, 0, SAMPLE_W, SAMPLE_H);
  return c;
}
