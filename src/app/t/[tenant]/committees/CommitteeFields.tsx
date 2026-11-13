'use client';
import { useState } from 'react';

export interface Choices {
  types: { key: string; name: string; defaultCategory: string | null }[];
  categories: { key: string; name: string }[];
}

export interface CommitteeValues {
  name: string;
  abbreviation: string;
  topic: string;
  description: string;
  category_key: string | null;
  type_key: string;
  language: string | null;
}

// The fields of a committee, for adding one and for editing it. Picking a type moves the
// category to that type's usual one, unless the person has chosen a category themselves.
export function CommitteeFields({
  choices,
  languages,
  defaultLanguage,
  values,
  L,
}: {
  choices: Choices;
  languages: { code: string; name: string }[];
  defaultLanguage: string;
  values?: CommitteeValues;
  L: { name: string; abbreviation: string; category: string; type: string; language: string; topic: string; description: string; noCategory: string };
}) {
  const firstType = choices.types[0]!;
  const [type, setType] = useState(values?.type_key ?? firstType.key);
  const [category, setCategory] = useState(values ? (values.category_key ?? '') : (firstType.defaultCategory ?? ''));
  const [touched, setTouched] = useState(!!values);
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <label className="flex flex-col gap-1">
        <span className="label">{L.name}</span>
        <input className="input" name="name" required maxLength={120} defaultValue={values?.name ?? ''} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label">{L.abbreviation}</span>
        <input className="input" name="abbreviation" maxLength={20} defaultValue={values?.abbreviation ?? ''} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label">{L.type}</span>
        <select
          className="input"
          name="type"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            const next = choices.types.find((x) => x.key === e.target.value);
            if (!touched && next) setCategory(next.defaultCategory ?? '');
          }}
        >
          {choices.types.map((x) => (
            <option key={x.key} value={x.key}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="label">{L.category}</span>
        <select
          className="input"
          name="category"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setTouched(true);
          }}
        >
          <option value="">{L.noCategory}</option>
          {choices.categories.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="label">{L.language}</span>
        <select className="input" name="language" defaultValue={values?.language ?? ''}>
          <option value="">{defaultLanguage}</option>
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 md:col-span-2">
        <span className="label">{L.topic}</span>
        <input className="input" name="topic" maxLength={500} defaultValue={values?.topic ?? ''} />
      </label>
      {values ? (
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="label">{L.description}</span>
          <textarea className="input min-h-24" name="description" maxLength={4000} defaultValue={values.description} />
        </label>
      ) : null}
    </div>
  );
}
