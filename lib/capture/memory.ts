/* CAPTURE_DEBUG: memory as Linux sees it while a capture runs, for the phase log. Reads /proc only
   (elsewhere every figure is just left out). Server only. */
import { readdirSync, readFileSync } from 'node:fs';

const MB = 1024 * 1024;
const read = (file: string) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};
/** A "Name:   123 kB" field of /proc/meminfo or /proc/<pid>/status, in bytes. */
const kbField = (text: string, name: string) => {
  const m = new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(text);
  return m ? Number(m[1]) * 1024 : NaN;
};
const mb = (bytes: number) => (Number.isFinite(bytes) ? `${Math.round(bytes / MB)}MB` : '?');

/** The kernel's OOM-kill count so far (system-wide), or NaN. */
const oomKills = () => Number(/^oom_kill (\d+)/m.exec(read('/proc/vmstat'))?.[1] ?? NaN);

/** This process's direct children whose name looks like Chromium's. */
function browserPids(): number[] {
  let dirs: string[];
  try {
    dirs = readdirSync('/proc').filter((d) => /^\d+$/.test(d));
  } catch {
    return [];
  }
  return dirs
    .map((d) => {
      const stat = read(`/proc/${d}/stat`); // "pid (comm) state ppid ..."
      const close = stat.lastIndexOf(')');
      const comm = stat.slice(stat.indexOf('(') + 1, close);
      const ppid = Number(stat.slice(close + 2).split(' ')[1]);
      return ppid === process.pid && /chrom|headless/i.test(comm) ? Number(d) : 0;
    })
    .filter(Boolean);
}

export interface MemoryProbe {
  /** e.g. "avail 1203MB (least 1100MB of 2048MB), browser 850MB (peak 900MB), node 250MB, tmpfs 300MB, OOM kills 0" */
  note(): string;
  stop(): void;
}

/** Samples every `everyMs` from now until stop(), so the note can give the lowest free memory and the
 *  browser's peak between phases (the browser's own peak survives in VmHWM; free memory doesn't). */
export function memoryProbe(everyMs = 250): MemoryProbe {
  const oom0 = oomKills();
  let least = Infinity;
  let pids: number[] = [];
  let browser = { rss: NaN, peak: NaN };
  const sample = () => {
    const avail = kbField(read('/proc/meminfo'), 'MemAvailable');
    if (avail < least) least = avail;
    if (!pids.length) pids = browserPids();
    const status = pids.map((p) => read(`/proc/${p}/status`)).filter(Boolean);
    if (status.length) {
      browser = {
        rss: status.reduce((n, s) => n + kbField(s, 'VmRSS'), 0),
        peak: status.reduce((n, s) => n + kbField(s, 'VmHWM'), 0),
      };
    }
  };
  sample();
  const timer = setInterval(sample, everyMs);
  timer.unref?.();
  return {
    note() {
      sample();
      const info = read('/proc/meminfo');
      const kills = oomKills() - oom0;
      return [
        `avail ${mb(kbField(info, 'MemAvailable'))} (least ${mb(least)} of ${mb(kbField(info, 'MemTotal'))})`,
        `browser ${mb(browser.rss)} (peak ${mb(browser.peak)})`,
        `node ${mb(process.memoryUsage().rss)}`,
        `tmpfs ${mb(kbField(info, 'Shmem'))}`,
        `OOM kills ${Number.isFinite(kills) ? kills : '?'}`,
      ].join(', ');
    },
    stop: () => clearInterval(timer),
  };
}
