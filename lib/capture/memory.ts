/* CAPTURE_DEBUG: memory as Linux sees it while a capture runs, for the phase log, and the free space
   in the temp folder (where the serverless Chromium lives, and its shared memory with
   --disable-dev-shm-usage). Reads /proc (elsewhere those figures are just left out). Server only. */
import { lstatSync, readdirSync, readFileSync, statfsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
/** Free and total bytes in the temp folder's file system. */
const tmpSpace = () => {
  try {
    const s = statfsSync(os.tmpdir());
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch {
    return { free: NaN, total: NaN };
  }
};

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
  /** e.g. "avail 1203MB (least 1100MB of 2048MB), browser 850MB (peak 900MB), node 250MB, tmpfs 0MB,
   *  /tmp free 230MB (least 120MB of 512MB), OOM kills 0" */
  note(): string;
  stop(): void;
}

/** Samples every `everyMs` from now until stop(), so the note can give the lowest free memory and the
 *  browser's peak between phases (the browser's own peak survives in VmHWM; free memory doesn't). */
export function memoryProbe(everyMs = 250): MemoryProbe {
  const oom0 = oomKills();
  let least = Infinity;
  let leastTmp = Infinity;
  let pids: number[] = [];
  let browser = { rss: NaN, peak: NaN };
  const sample = () => {
    const avail = kbField(read('/proc/meminfo'), 'MemAvailable');
    if (avail < least) least = avail;
    const tmp = tmpSpace().free;
    if (tmp < leastTmp) leastTmp = tmp;
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
        `${os.tmpdir()} free ${mb(tmpSpace().free)} (least ${mb(leastTmp)} of ${mb(tmpSpace().total)})`,
        `OOM kills ${Number.isFinite(kills) ? kills : '?'}`,
      ].join(', ');
    },
    stop: () => clearInterval(timer),
  };
}

/** What takes up the temp folder (its entries, largest first) and whether /dev/shm is there. */
export function tempReport(): string {
  const size = (p: string): number => {
    try {
      const s = lstatSync(p);
      if (!s.isDirectory()) return s.size;
      return readdirSync(p).reduce((n, e) => n + size(path.join(p, e)), 0);
    } catch {
      return 0;
    }
  };
  let entries: string[] = [];
  try {
    entries = readdirSync(os.tmpdir());
  } catch {
    /* leave it empty */
  }
  const listed = entries
    .map((e) => ({ e, n: size(path.join(os.tmpdir(), e)) }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 12)
    .map(({ e, n }) => `${e} ${mb(n)}`)
    .join(', ');
  let shm = 'missing';
  try {
    const s = statfsSync('/dev/shm');
    shm = `free ${mb(s.bavail * s.bsize)} of ${mb(s.blocks * s.bsize)}`;
  } catch {
    /* no /dev/shm */
  }
  return `${os.tmpdir()}: ${listed}; /dev/shm ${shm}`;
}
