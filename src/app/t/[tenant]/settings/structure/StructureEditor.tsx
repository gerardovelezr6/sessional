"use client";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  FLAG_SOURCES,
  keyFrom,
  type Category,
  type CommitteeType,
  type Group,
  type Structure,
} from "@/structure/schema";
import { NEW_ITEM_COLOR } from "@/structure/presets";
import type { StructureState } from "./actions";
import type { EditorLabels } from "./labels";
import { goTo } from "@/components/go";

// Edits the school's committee categories and types. The whole structure travels to the server as
// JSON in one hidden field; new group logos travel as files. The server checks everything again.

type Action = (
  state: StructureState,
  data: FormData,
) => Promise<StructureState>;
type Text = Record<string, string>;

interface Props {
  action: Action;
  initial: Structure;
  locales: { code: string; label: string; dir: "ltr" | "rtl" }[];
  logoUrls: Record<string, string>;
  L: EditorLabels;
}

const fill = (pattern: string, values: Record<string, string>) =>
  pattern.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);
const move = <T,>(list: T[], i: number, by: number): T[] => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
};

function Submit({
  label,
  intent,
  primary,
}: {
  label: string;
  intent: string;
  primary?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="intent"
      value={intent}
      className={`btn ${primary ? "btn-primary" : "btn-secondary"}`}
      disabled={pending}
      aria-busy={pending}
    >
      {label}
    </button>
  );
}

// One text per language, side by side.
function TextFields({
  label,
  value,
  onChange,
  locales,
  maxLength,
}: {
  label: string;
  value: Text;
  onChange: (v: Text) => void;
  locales: Props["locales"];
  maxLength: number;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="label">{label}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {locales.map((l) => (
          <input
            key={l.code}
            className="input"
            value={value[l.code] ?? ""}
            onChange={(e) => onChange({ ...value, [l.code]: e.target.value })}
            maxLength={maxLength}
            lang={l.code}
            dir={l.dir}
            placeholder={l.label}
            aria-label={`${label}, ${l.label}`}
          />
        ))}
      </div>
    </fieldset>
  );
}

function RowButtons({
  onUp,
  onDown,
  onRemove,
  L,
  name,
  canRemove = true,
}: {
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
  L: EditorLabels;
  name: string;
  canRemove?: boolean;
}) {
  return (
    <div className="flex gap-1">
      <button
        type="button"
        className="btn btn-secondary"
        onClick={onUp}
        aria-label={`${L.moveUp}: ${name}`}
      >
        ↑
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={onDown}
        aria-label={`${L.moveDown}: ${name}`}
      >
        ↓
      </button>
      {canRemove ? (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onRemove}
          aria-label={`${L.remove}: ${name}`}
        >
          {L.remove}
        </button>
      ) : null}
    </div>
  );
}

const firstName = (t: Text) => Object.values(t).find((v) => v.trim()) ?? "";

export function StructureEditor({
  action,
  initial,
  locales,
  logoUrls,
  L,
}: Props) {
  const [state, formAction] = useActionState(action, {});
  const [s, setS] = useState<Structure>(initial);
  // Keys of items added in this session: their key follows their name until saved.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (state.redirectTo) goTo(state.redirectTo);
  }, [state]);

  const named = (text: Text, key: string, taken: string[], isFresh: boolean) =>
    isFresh
      ? keyFrom(
          firstName(text) || key,
          taken.filter((k) => k !== key),
        )
      : key;

  const setCategory = (i: number, c: Category) =>
    setS({ ...s, categories: s.categories.map((x, j) => (j === i ? c : x)) });
  const setType = (i: number, t: CommitteeType) =>
    setS({ ...s, types: s.types.map((x, j) => (j === i ? t : x)) });
  const label = (t: Text, fallback: string) => firstName(t) || fallback;

  const json = useMemo(() => JSON.stringify(s), [s]);

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <input type="hidden" name="structure" value={json} />

      <section
        aria-labelledby="categories-title"
        className="flex flex-col gap-3"
      >
        <h2 id="categories-title" className="text-lg font-bold text-on-surface">
          {L.categoriesTitle}
        </h2>
        <p className="text-sm">{L.categoriesHelp}</p>
        {s.categories.length === 0 ? (
          <p className="text-sm text-on-surface-muted">{L.categoriesEmpty}</p>
        ) : null}
        <ul className="flex flex-col gap-3" aria-label={L.categoriesTitle}>
          {s.categories.map((c, i) => (
            <li
              key={`${c.key}-${i}`}
              className="grid grid-cols-1 items-end gap-3 rounded-control border border-border p-3 md:grid-cols-[auto_1fr_auto]"
            >
              <label className="flex flex-col gap-1">
                <span className="label">{L.color}</span>
                <input
                  type="color"
                  className="h-10 w-14 rounded-control border border-border-strong bg-surface-raised p-1"
                  value={c.color.toLowerCase()}
                  onChange={(e) =>
                    setCategory(i, {
                      ...c,
                      color: e.target.value.toUpperCase(),
                    })
                  }
                  aria-label={`${L.color}: ${label(c.name, c.key)}`}
                />
              </label>
              <TextFields
                label={L.name}
                value={c.name}
                locales={locales}
                maxLength={80}
                onChange={(name) =>
                  setCategory(i, {
                    ...c,
                    name,
                    key: named(
                      name,
                      c.key,
                      s.categories.map((x) => x.key),
                      fresh.has(c.key),
                    ),
                  })
                }
              />
              <RowButtons
                L={L}
                name={label(c.name, c.key)}
                onUp={() =>
                  setS({ ...s, categories: move(s.categories, i, -1) })
                }
                onDown={() =>
                  setS({ ...s, categories: move(s.categories, i, 1) })
                }
                onRemove={() =>
                  setS({
                    ...s,
                    categories: s.categories.filter((_, j) => j !== i),
                  })
                }
              />
            </li>
          ))}
        </ul>
        <div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              const key = keyFrom(
                "category",
                s.categories.map((x) => x.key),
              );
              setFresh(new Set([...fresh, key]));
              setS({
                ...s,
                categories: [
                  ...s.categories,
                  { key, name: {}, color: NEW_ITEM_COLOR },
                ],
              });
            }}
          >
            {L.addCategory}
          </button>
        </div>
      </section>

      <section aria-labelledby="types-title" className="flex flex-col gap-3">
        <h2 id="types-title" className="text-lg font-bold text-on-surface">
          {L.typesTitle}
        </h2>
        <p className="text-sm">{L.typesHelp}</p>
        <ul className="flex flex-col gap-3" aria-label={L.typesTitle}>
          {s.types.map((type, i) => {
            const isFresh = fresh.has(type.key);
            const columns = [
              "label",
              "name",
              ...(type.groups.length ? ["group"] : []),
              ...type.fields.map((f) => f.key),
            ];
            const columnName = (c: string) =>
              c === "label"
                ? L.columnLabel
                : c === "name"
                  ? L.columnName
                  : c === "group"
                    ? L.columnGroup
                    : label(
                        type.fields.find((f) => f.key === c)?.name ?? {},
                        c,
                      );
            const setGroup = (gi: number, g: Group) =>
              setType(i, {
                ...type,
                groups: type.groups.map((x, j) => (j === gi ? g : x)),
              });
            return (
              <li key={`${type.key}-${i}`}>
                <details
                  className="rounded-control border border-border p-3"
                  open={isFresh}
                >
                  <summary className="cursor-pointer font-semibold text-on-surface">
                    {label(type.name, type.key)}{" "}
                    <span className="font-mono text-xs font-normal text-on-surface-muted">
                      {fill(L.key, { key: type.key })}
                    </span>
                  </summary>
                  <div className="mt-4 flex flex-col gap-5">
                    <TextFields
                      label={L.name}
                      value={type.name}
                      locales={locales}
                      maxLength={80}
                      onChange={(name) =>
                        setType(i, {
                          ...type,
                          name,
                          key: named(
                            name,
                            type.key,
                            s.types.map((x) => x.key),
                            isFresh,
                          ),
                        })
                      }
                    />
                    <div>
                      <TextFields
                        label={L.labelField}
                        value={type.labelField}
                        locales={locales}
                        maxLength={60}
                        onChange={(labelField) =>
                          setType(i, { ...type, labelField })
                        }
                      />
                      <p className="mt-1 text-xs text-on-surface-muted">
                        {L.labelFieldHelp}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <label className="flex flex-col gap-1">
                        <span className="label">{L.flag}</span>
                        <select
                          className="input"
                          value={type.flag}
                          onChange={(e) =>
                            setType(i, {
                              ...type,
                              flag: e.target.value as CommitteeType["flag"],
                            })
                          }
                        >
                          {FLAG_SOURCES.map((f) => (
                            <option key={f} value={f}>
                              {L[`flag_${f}`]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="label">{L.defaultCategory}</span>
                        <select
                          className="input"
                          value={type.defaultCategory ?? ""}
                          onChange={(e) =>
                            setType(i, {
                              ...type,
                              defaultCategory: e.target.value || null,
                            })
                          }
                        >
                          <option value="">{L.noCategory}</option>
                          {s.categories.map((c) => (
                            <option key={c.key} value={c.key}>
                              {label(c.name, c.key)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={type.confidentialTopic}
                        onChange={(e) =>
                          setType(i, {
                            ...type,
                            confidentialTopic: e.target.checked,
                          })
                        }
                      />
                      <span>
                        <span className="font-semibold text-on-surface">
                          {L.confidential}
                        </span>
                        <br />
                        {L.confidentialHelp}
                      </span>
                    </label>

                    <fieldset className="flex flex-col gap-3 rounded-control border border-border p-3">
                      <legend className="px-1 font-semibold text-on-surface">
                        {L.groups}
                      </legend>
                      <TextFields
                        label={L.groupLabel}
                        value={type.groupLabel}
                        locales={locales}
                        maxLength={60}
                        onChange={(groupLabel) =>
                          setType(i, { ...type, groupLabel })
                        }
                      />
                      <p className="-mt-2 text-xs text-on-surface-muted">
                        {L.groupLabelHelp}
                      </p>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={type.groupRequired}
                          onChange={(e) =>
                            setType(i, {
                              ...type,
                              groupRequired: e.target.checked,
                            })
                          }
                          disabled={!type.groups.length}
                        />
                        {L.groupRequired}
                      </label>
                      <ul
                        className="flex flex-col gap-3"
                        aria-label={`${L.groups}: ${label(type.name, type.key)}`}
                      >
                        {type.groups.map((g, gi) => (
                          <li
                            key={`${g.key}-${gi}`}
                            className="flex flex-col gap-2 border-t border-border pt-3"
                          >
                            <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[auto_1fr_8rem]">
                              <label className="flex flex-col gap-1">
                                <span className="label">{L.color}</span>
                                <input
                                  type="color"
                                  className="h-10 w-14 rounded-control border border-border-strong bg-surface-raised p-1"
                                  value={g.color.toLowerCase()}
                                  onChange={(e) =>
                                    setGroup(gi, {
                                      ...g,
                                      color: e.target.value.toUpperCase(),
                                    })
                                  }
                                  aria-label={`${L.color}: ${label(g.name, g.key)}`}
                                />
                              </label>
                              <TextFields
                                label={L.name}
                                value={g.name}
                                locales={locales}
                                maxLength={60}
                                onChange={(name) =>
                                  setGroup(gi, {
                                    ...g,
                                    name,
                                    key: named(
                                      name,
                                      g.key,
                                      type.groups.map((x) => x.key),
                                      fresh.has(`${type.key}/${g.key}`),
                                    ),
                                  })
                                }
                              />
                              <label className="flex flex-col gap-1">
                                <span className="label">{L.short}</span>
                                <input
                                  className="input"
                                  value={g.short}
                                  maxLength={12}
                                  onChange={(e) =>
                                    setGroup(gi, {
                                      ...g,
                                      short: e.target.value,
                                    })
                                  }
                                  aria-label={`${L.short}: ${label(g.name, g.key)}`}
                                />
                              </label>
                            </div>
                            <label className="flex flex-col gap-1">
                              <span className="label">{L.aliases}</span>
                              <input
                                className="input"
                                value={g.aliases.join(", ")}
                                onChange={(e) =>
                                  setGroup(gi, {
                                    ...g,
                                    aliases: e.target.value
                                      .split(",")
                                      .map((a) => a.trim())
                                      .filter(Boolean)
                                      .slice(0, 20),
                                  })
                                }
                                aria-label={`${L.aliases}: ${label(g.name, g.key)}`}
                              />
                              <span className="text-xs text-on-surface-muted">
                                {L.aliasesHelp}
                              </span>
                            </label>
                            <div className="flex flex-wrap items-center gap-3 text-sm">
                              <span className="label">{L.logo}</span>
                              {g.logo && logoUrls[g.logo] ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={logoUrls[g.logo]}
                                  alt=""
                                  className="h-8 w-auto rounded-control border border-border"
                                />
                              ) : null}
                              <input
                                type="file"
                                name={`logo:${type.key}:${g.key}`}
                                accept="image/png,image/jpeg,image/webp"
                                aria-label={`${L.logo}: ${label(g.name, g.key)}`}
                              />
                              {g.logo ? (
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={() =>
                                    setGroup(gi, { ...g, logo: null })
                                  }
                                >
                                  {L.remove}
                                </button>
                              ) : null}
                            </div>
                            <RowButtons
                              L={L}
                              name={label(g.name, g.key)}
                              onUp={() =>
                                setType(i, {
                                  ...type,
                                  groups: move(type.groups, gi, -1),
                                })
                              }
                              onDown={() =>
                                setType(i, {
                                  ...type,
                                  groups: move(type.groups, gi, 1),
                                })
                              }
                              onRemove={() => {
                                const groups = type.groups.filter(
                                  (_, j) => j !== gi,
                                );
                                setType(i, {
                                  ...type,
                                  groups,
                                  groupRequired: groups.length
                                    ? type.groupRequired
                                    : false,
                                  bulk: groups.length
                                    ? type.bulk
                                    : type.bulk.filter((c) => c !== "group"),
                                  flag:
                                    !groups.length && type.flag === "group_logo"
                                      ? "none"
                                      : type.flag,
                                });
                              }}
                            />
                          </li>
                        ))}
                      </ul>
                      <div>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            const key = keyFrom(
                              "group",
                              type.groups.map((x) => x.key),
                            );
                            setFresh(new Set([...fresh, `${type.key}/${key}`]));
                            setType(i, {
                              ...type,
                              groups: [
                                ...type.groups,
                                {
                                  key,
                                  name: {},
                                  short: "",
                                  color: NEW_ITEM_COLOR,
                                  logo: null,
                                  aliases: [],
                                },
                              ],
                            });
                          }}
                        >
                          {L.addGroup}
                        </button>
                      </div>
                    </fieldset>

                    <fieldset className="flex flex-col gap-3 rounded-control border border-border p-3">
                      <legend className="px-1 font-semibold text-on-surface">
                        {L.fields}
                      </legend>
                      <p className="text-xs text-on-surface-muted">
                        {L.fieldsHelp}
                      </p>
                      {type.fields.map((f, fi) => (
                        <div
                          key={`${f.key}-${fi}`}
                          className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_auto]"
                        >
                          <TextFields
                            label={L.name}
                            value={f.name}
                            locales={locales}
                            maxLength={60}
                            onChange={(name) => {
                              const key = named(
                                name,
                                f.key,
                                [
                                  "label",
                                  "name",
                                  "group",
                                  ...type.fields.map((x) => x.key),
                                ],
                                fresh.has(`${type.key}#${f.key}`),
                              );
                              setType(i, {
                                ...type,
                                fields: type.fields.map((x, j) =>
                                  j === fi ? { key, name } : x,
                                ),
                                bulk: type.bulk.map((c) =>
                                  c === f.key ? key : c,
                                ),
                              });
                            }}
                          />
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() =>
                              setType(i, {
                                ...type,
                                fields: type.fields.filter((_, j) => j !== fi),
                                bulk: type.bulk.filter((c) => c !== f.key),
                              })
                            }
                          >
                            {L.remove}
                          </button>
                        </div>
                      ))}
                      <div>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={type.fields.length >= 10}
                          onClick={() => {
                            const key = keyFrom("field", [
                              "label",
                              "name",
                              "group",
                              ...type.fields.map((x) => x.key),
                            ]);
                            setFresh(new Set([...fresh, `${type.key}#${key}`]));
                            setType(i, {
                              ...type,
                              fields: [...type.fields, { key, name: {} }],
                            });
                          }}
                        >
                          {L.addField}
                        </button>
                      </div>
                    </fieldset>

                    <fieldset className="flex flex-col gap-2">
                      <legend className="font-semibold text-on-surface">
                        {L.bulk}
                      </legend>
                      <p className="text-xs text-on-surface-muted">
                        {L.bulkHelp}
                      </p>
                      <ol className="flex flex-col gap-2" aria-label={L.bulk}>
                        {type.bulk.map((c, ci) => (
                          <li key={c} className="flex items-center gap-2">
                            <span className="w-6 text-sm text-on-surface-muted">
                              {ci + 1}.
                            </span>
                            <span className="flex-1 font-semibold text-on-surface">
                              {columnName(c)}
                            </span>
                            <RowButtons
                              L={L}
                              name={columnName(c)}
                              canRemove={c !== "label"}
                              onUp={() =>
                                setType(i, {
                                  ...type,
                                  bulk: move(type.bulk, ci, -1),
                                })
                              }
                              onDown={() =>
                                setType(i, {
                                  ...type,
                                  bulk: move(type.bulk, ci, 1),
                                })
                              }
                              onRemove={() =>
                                setType(i, {
                                  ...type,
                                  bulk: type.bulk.filter((x) => x !== c),
                                })
                              }
                            />
                          </li>
                        ))}
                      </ol>
                      <div className="flex flex-wrap gap-2">
                        {columns
                          .filter((c) => !type.bulk.includes(c))
                          .map((c) => (
                            <button
                              key={c}
                              type="button"
                              className="btn btn-secondary"
                              onClick={() =>
                                setType(i, { ...type, bulk: [...type.bulk, c] })
                              }
                            >
                              + {columnName(c)}
                            </button>
                          ))}
                      </div>
                    </fieldset>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                      <span className="text-sm font-semibold text-on-surface">
                        {label(type.name, type.key)}
                      </span>
                      <RowButtons
                        L={L}
                        name={label(type.name, type.key)}
                        canRemove={s.types.length > 1}
                        onUp={() => setS({ ...s, types: move(s.types, i, -1) })}
                        onDown={() =>
                          setS({ ...s, types: move(s.types, i, 1) })
                        }
                        onRemove={() =>
                          setS({
                            ...s,
                            types: s.types.filter((_, j) => j !== i),
                          })
                        }
                      />
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
        <div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              const key = keyFrom(
                "type",
                s.types.map((x) => x.key),
              );
              setFresh(new Set([...fresh, key]));
              setS({
                ...s,
                types: [
                  ...s.types,
                  {
                    key,
                    name: {},
                    defaultCategory: null,
                    labelField: { en: "Country", es: "País" },
                    flag: "country",
                    groupLabel: {},
                    groups: [],
                    groupRequired: false,
                    confidentialTopic: false,
                    fields: [],
                    bulk: ["label", "name"],
                  },
                ],
              });
            }}
          >
            {L.addType}
          </button>
        </div>
      </section>

      {state.error ? (
        <p role="alert" className="error-text whitespace-pre-line">
          {state.error}
        </p>
      ) : null}
      <div className="card-footer">
        <Submit label={L.saveDraft} intent="draft" />
        <Submit label={L.saveAndPublish} intent="publish" primary />
      </div>
    </form>
  );
}

// Adds the standard Model UN categories and types, keeping what the school already has.
export function AddStandard({
  action,
  label,
}: {
  action: () => Promise<StructureState>;
  label: string;
}) {
  const [state, formAction] = useActionState(
    async () => action(),
    {} as StructureState,
  );
  useEffect(() => {
    if (state.redirectTo) goTo(state.redirectTo);
  }, [state]);
  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <Submit label={label} intent="standard" />
      {state.error ? (
        <p role="alert" className="error-text">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
