/* One capture at a time: a promise chain. Each task starts after the previous one settles. */
export type Serial = <T>(task: () => Promise<T>) => Promise<T>;

export function createSerialQueue(): Serial {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>) => {
    const run = tail.then(() => task());
    tail = run.catch(() => undefined);
    return run;
  };
}
