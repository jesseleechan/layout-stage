/* Undo history: a bounded stack of Composition snapshots. Images live in the image store and are
   referenced by id, so a snapshot is a few hundred bytes. */
import { clone, HISTORY_LIMIT, type Composition } from './model';

const stamp = (d: Composition) => JSON.stringify(d);

export class History {
  private past: Composition[] = [];
  private future: Composition[] = [];
  private base!: Composition;
  private baseStamp = '';

  constructor(doc: Composition, private limit = HISTORY_LIMIT) {
    this.reset(doc);
  }

  /** Forget all steps; `doc` becomes the new base. */
  reset(doc: Composition): void {
    this.past = [];
    this.future = [];
    this.base = clone(doc);
    this.baseStamp = stamp(doc);
  }

  /** Saves a step when `doc` differs from the last saved state. Returns whether a step was saved. */
  commit(doc: Composition): boolean {
    const st = stamp(doc);
    if (st === this.baseStamp) return false;
    this.past.push(this.base);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.base = clone(doc);
    this.baseStamp = st;
    return true;
  }

  /** Returns the previous state, or null. Uncommitted live edits are discarded. */
  undo(): Composition | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(this.base);
    this.base = prev;
    this.baseStamp = stamp(prev);
    return clone(prev);
  }

  redo(): Composition | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(this.base);
    this.base = next;
    this.baseStamp = stamp(next);
    return clone(next);
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  get depth(): number {
    return this.past.length;
  }
}
