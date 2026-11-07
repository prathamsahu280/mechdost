'use client';

import type { LucideIcon } from 'lucide-react';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export interface SelectOption<V extends string> {
  value: V;
  label: string;
  icon?: LucideIcon;
}

/**
 * Custom select (user 2026-11-02: "select ka div bhi apna custom hona chahiye"). WAI-ARIA APG "select-only
 * combobox": focus stays on the combobox button, the active option is announced via aria-activedescendant.
 * Keyboard: ↑/↓/Home/End move, Enter/Space choose, Escape closes, Tab chooses the active option, letters jump
 * (typeahead). A hidden input carries `name`/`value`, so the surrounding GET form still submits it.
 * `trackPrefix` puts `data-track` on options for the analytics click listener (hard rule 9).
 */
export function Select<V extends string>({
  id,
  name,
  value,
  options,
  onChange,
  trackPrefix,
  className = '',
}: {
  id: string;
  name: string;
  value: V;
  options: readonly SelectOption<V>[];
  onChange: (value: V) => void;
  trackPrefix?: string;
  className?: string;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ text: '', at: 0 });
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const [active, setActive] = useState(selectedIndex);
  const current = options[selectedIndex];
  const CurrentIcon = current?.icon;

  // Close on a pointer press outside the control.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  // Keep the active option in view while moving with the keyboard.
  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function openList() {
    setActive(selectedIndex);
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    setOpen(false);
    if (option && option.value !== value) onChange(option.value);
  }

  function jumpTo(key: string) {
    const now = Date.now();
    const t = typeahead.current;
    t.text = now - t.at > 600 ? key : t.text + key;
    t.at = now;
    const start = open ? active + 1 : selectedIndex + 1;
    const ordered = [...options.slice(start), ...options.slice(0, start)];
    const hit = ordered.find((o) => o.label.toLocaleLowerCase().startsWith(t.text.toLocaleLowerCase()));
    if (!hit) return;
    const index = options.indexOf(hit);
    if (open) setActive(index);
    else if (hit.value !== value) onChange(hit.value);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const last = options.length - 1;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openList();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        jumpTo(e.key);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((i) => Math.min(last, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(last);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        choose(active);
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      case 'Tab':
        choose(active);
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) jumpTo(e.key);
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <input type="hidden" name={name} value={value} />
      <button
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${String(active)}` : undefined}
        onClick={() => {
          if (open) setOpen(false);
          else openList();
        }}
        onKeyDown={onKeyDown}
        className={`flex min-h-11 w-full items-center gap-2 rounded-input border bg-surface px-3 text-left text-[15px] text-ink transition-[border-color,box-shadow] duration-[var(--duration-fast)] ${
          open ? 'border-ink shadow-[0_0_0_3px_var(--color-pill)]' : 'border-input-border hover:border-ink'
        }`}
      >
        {CurrentIcon ? <CurrentIcon aria-hidden="true" className="size-4 shrink-0 text-muted" /> : null}
        <span className="min-w-0 flex-1 truncate">{current?.label}</span>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 text-muted transition-transform duration-[var(--duration-base)] ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-labelledby={`${id}-label`}
        tabIndex={-1}
        hidden={!open}
        className="md-select-list absolute inset-x-0 top-[calc(100%+6px)] z-30 max-h-72 overflow-y-auto rounded-tile border border-line-card bg-surface p-1.5 shadow-card-hover"
      >
        {options.map((o, i) => {
          const Icon = o.icon;
          const selected = o.value === value;
          return (
            <li
              key={o.value}
              id={`${listId}-${String(i)}`}
              role="option"
              aria-selected={selected}
              data-track={trackPrefix ? `${trackPrefix}_${o.value || 'all'}` : undefined}
              onPointerMove={() => {
                setActive(i);
              }}
              onClick={() => {
                choose(i);
              }}
              className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[9px] px-2.5 text-sm ${
                i === active ? 'bg-pill' : ''
              } ${selected ? 'font-extrabold text-ink' : 'font-medium text-ink'}`}
            >
              {Icon ? (
                <Icon
                  aria-hidden="true"
                  className={`size-4 shrink-0 ${selected ? 'text-accent-soft-text' : 'text-muted'}`}
                />
              ) : null}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {selected ? (
                <Check aria-hidden="true" className="size-4 shrink-0 text-accent-soft-text" />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
