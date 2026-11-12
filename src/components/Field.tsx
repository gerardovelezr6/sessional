// A labelled input. Server-rendered; the label is always tied to its control.
export function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  required = true,
  hint,
  minLength,
}: {
  label: string;
  name: string;
  type?: 'text' | 'email' | 'password';
  autoComplete?: string;
  required?: boolean;
  hint?: string;
  minLength?: number;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      <input className="input" id={name} name={name} type={type} autoComplete={autoComplete} required={required} minLength={minLength} aria-describedby={hint ? `${name}-hint` : undefined} />
      {hint ? (
        <p id={`${name}-hint`} className="mt-1 text-xs text-on-surface-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
