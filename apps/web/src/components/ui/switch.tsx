/**
 * On/off switch (design system "Switch", 2026-11-03): a native checkbox with `role="switch"`, a 48 x 28 track and a
 * short "On / Off" text, so the state never rests on colour alone. The caller supplies the visible label with
 * `<label htmlFor={id}>`; the track is the tap target (44 px high via the wrapper).
 */
export function Switch({
  id,
  checked,
  onChange,
  onText,
  offText,
  describedBy,
  disabled = false,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  onText: string;
  offText: string;
  describedBy?: string;
  /** Read-only screens: not focusable as a working control and shown dimmed (state still in words). */
  disabled?: boolean;
}) {
  return (
    <label
      className={`inline-flex min-h-11 items-center gap-3 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
    >
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="relative h-7 w-12 shrink-0 rounded-pill bg-input-border transition-colors peer-checked:bg-accent-button peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus after:absolute after:top-1 after:left-1 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5 motion-reduce:transition-none motion-reduce:after:transition-none"
      />
      <span aria-hidden="true" className="w-8 text-xs font-bold text-muted">
        {checked ? onText : offText}
      </span>
    </label>
  );
}
