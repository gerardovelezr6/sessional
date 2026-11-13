'use client';

// On narrow screens the settings menu becomes one dropdown, so the section itself is in view.
export function SectionPicker({ label, current, groups }: { label: string; current: string; groups: { label: string; options: { value: string; href: string; label: string }[] }[] }) {
  return (
    <div>
      <label className="label" htmlFor="section-picker">
        {label}
      </label>
      <select
        id="section-picker"
        className="input"
        value={current}
        onChange={(e) => {
          const href = groups.flatMap((g) => g.options).find((o) => o.value === e.target.value)?.href;
          if (href) window.location.assign(href);
        }}
      >
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
