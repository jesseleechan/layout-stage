'use client';
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/* A layout row's Replace menu (menu button pattern). Enter, Space or ↓ opens it on the first item,
   ↑ on the last; ↑ ↓ Home End move between items; Enter or Space chooses one; Esc closes it and puts
   focus back on the button; Tab, a click outside and choosing an item close it. Keys stay out of the
   editor's shortcuts (arrows would nudge the selected layout). */

export interface MenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect(): void;
}

interface Props {
  /** The button's accessible name, e.g. "Replace layout 2". */
  label: string;
  title?: string;
  icon: ReactNode;
  items: MenuItem[];
}

export default function ReplaceMenu({ label, title, icon, items }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const startAt = useRef<'first' | 'last'>('first');
  const uid = useId();

  const menuItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  // On open: focus the first (or last) item; close on a press anywhere else.
  useLayoutEffect(() => {
    if (!open) return;
    const list = menuItems();
    (startAt.current === 'last' ? list[list.length - 1] : list[0])?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const show = (at: 'first' | 'last') => {
    startAt.current = at;
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    btnRef.current?.focus();
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    e.stopPropagation();
    const at = e.key === 'ArrowUp' ? 'last' : 'first';
    if (!open) return show(at);
    const list = menuItems(); // already open (focus came back to the button): move into it
    (at === 'last' ? list[list.length - 1] : list[0])?.focus();
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const list = menuItems();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') setOpen(false);
  };

  const choose = (item: MenuItem) => {
    if (item.disabled) return;
    close(); // focus goes back to the button first, so a dialog opened next returns it there
    item.onSelect();
  };

  return (
    <div className="menu-wrap">
      <button
        ref={btnRef}
        type="button"
        className="icon-btn xs"
        data-act="replace"
        aria-label={label}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${uid}m` : undefined}
        onClick={() => (open ? setOpen(false) : show('first'))}
        onKeyDown={onButtonKey}
      >
        {icon}
      </button>
      {open && (
        <div ref={menuRef} id={`${uid}m`} className="menu" role="menu" aria-label={label} onKeyDown={onMenuKey}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              data-act={item.key}
              aria-disabled={item.disabled || undefined}
              title={item.label}
              onClick={() => choose(item)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
