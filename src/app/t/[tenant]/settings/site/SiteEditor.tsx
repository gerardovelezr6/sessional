'use client';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, firstName, ListEditor, move, Names, Pick, type L, type Locale } from '@/components/edit';
import { goTo } from '@/components/go';
import { BLOCK_KINDS, SITE_PARTS as PARTS, type Block, type Site, type SitePart as Part } from '@/site/schema';
import type { SiteState } from './actions';

// The website editor: header, menu, home page blocks and the administration page.
// Changes are kept as a draft until published; the preview beside it shows the home page.

function Submit({ label, intent, primary }: { label: string; intent: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name="intent" value={intent} className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`} disabled={pending} aria-busy={pending}>
      {label}
    </button>
  );
}


function Url({ label, value, onChange, help }: { label: string; value: string; onChange: (v: string) => void; help: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <input className="input font-mono" maxLength={500} value={value} onChange={(e) => onChange(e.target.value.trim())} />
      <span className="text-xs">{help}</span>
    </label>
  );
}

export function SiteEditor({ action, initial, standard, locales, navWords, startPart, L }: { action: (s: SiteState, d: FormData) => Promise<SiteState>; initial: Site; standard: Site; locales: Locale[]; navWords: Record<string, string>; startPart: Part; L: L }) {
  const [state, formAction] = useActionState(action, {});
  const [site, setSite] = useState<Site>(initial);
  const [part, setPart] = useState<Part>(startPart);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (state.redirectTo) goTo(state.redirectTo);
  }, [state]);
  const json = useMemo(() => JSON.stringify({ page: site }), [site]);
  const set = <K extends keyof Site>(k: K, v: Site[K]) => setSite({ ...site, [k]: v });
  const blockName = (b: Block) => firstName(b.title) || L[`kind_${b.kind}`] || b.key;
  const choosePart = (p: Part) => {
    setPart(p);
    const url = new URL(window.location.href);
    url.searchParams.set('part', p);
    window.history.replaceState(window.history.state, '', url);
  };

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="site" value={json} />
      <input type="hidden" name="part" value={part} />
      <div role="tablist" aria-label={L.parts} className="tabs">
        {PARTS.map((p) => (
          <button key={p} type="button" role="tab" aria-selected={part === p} className="tab" onClick={() => choosePart(p)}>
            {L[`part_${p}`]}
          </button>
        ))}
      </div>

      {part === 'home' ? (
        <section className="flex flex-col gap-3" aria-label={L.part_home}>
          <p className="text-sm">{L.homeHelp}</p>
          <ListEditor
            title={L.blocks!}
            open
            items={site.home}
            onChange={(home) => set('home', home)}
            nameOf={blockName}
            L={L}
            min={1}
            make={(key): Block => ({ key, kind: 'text', visible: true, title: {}, body: {}, links: [] })}
            render={(b, put) => (
              <>
                <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[16rem_1fr]">
                  <Pick label={L.kind!} value={b.kind} options={BLOCK_KINDS.map((k) => ({ value: k, label: L[`kind_${k}`]! }))} onChange={(kind) => put({ ...b, kind })} />
                  <Check label={L.visible!} value={b.visible} onChange={(visible) => put({ ...b, visible })} />
                </div>
                <p className="text-xs">{L[`kindHelp_${b.kind}`]}</p>
                {b.kind === 'committees' || b.kind === 'myCommittees' || b.kind === 'text' || b.kind === 'links' || b.kind === 'placeholder' ? (
                  <Names label={L.heading!} value={b.title} locales={locales} max={120} onChange={(title) => put({ ...b, title })} />
                ) : null}
                {b.kind === 'text' || b.kind === 'placeholder' ? <Names label={L.body!} value={b.body} locales={locales} multiline max={2000} onChange={(body) => put({ ...b, body })} /> : null}
                {b.kind === 'links' ? (
                  <ListEditor
                    title={L.links!}
                    items={b.links.map((l, i) => ({ ...l, key: `link${i}` }))}
                    onChange={(links) => put({ ...b, links: links.map(({ label, url }) => ({ label, url })) })}
                    nameOf={(l) => firstName(l.label) || l.url}
                    L={L}
                    make={(key) => ({ key, label: {}, url: '/' })}
                    render={(l, putLink) => (
                      <>
                        <Names label={L.linkLabel!} value={l.label} locales={locales} max={60} onChange={(label) => putLink({ ...l, label })} />
                        <Url label={L.url!} help={L.urlHelp!} value={l.url} onChange={(url) => putLink({ ...l, url })} />
                      </>
                    )}
                  />
                ) : null}
              </>
            )}
          />
        </section>
      ) : null}


      {part === 'menu' ? (
        <section className="flex flex-col gap-3" aria-label={L.part_menu}>
          <p className="text-sm">{L.menuHelp}</p>
          <ul className="flex flex-col gap-2" aria-label={L.menuItems}>
            {site.nav.map((n, i) => (
              <li key={n.key} className="flex flex-col gap-2 rounded-control border border-border p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Check label={navWords[n.key]!} value={n.visible} onChange={(visible) => set('nav', site.nav.map((x, j) => (j === i ? { ...x, visible } : x)))} />
                  <span className="ms-auto flex gap-1">
                    <button type="button" className="btn btn-secondary btn-sm" aria-label={`${L.up}: ${navWords[n.key]}`} onClick={() => set('nav', move(site.nav, i, -1))}>
                      ↑
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" aria-label={`${L.down}: ${navWords[n.key]}`} onClick={() => set('nav', move(site.nav, i, 1))}>
                      ↓
                    </button>
                  </span>
                </div>
                <Names label={`${L.menuLabel}: ${navWords[n.key]}`} value={n.label} locales={locales} max={40} onChange={(label) => set('nav', site.nav.map((x, j) => (j === i ? { ...x, label } : x)))} />
              </li>
            ))}
          </ul>
          <ListEditor
            title={L.customLinks!}
            help={L.customLinksHelp}
            items={site.links}
            onChange={(links) => set('links', links)}
            nameOf={(l) => firstName(l.label) || l.url}
            L={L}
            make={(key) => ({ key, label: {}, url: 'https://' })}
            render={(l, put) => (
              <>
                <Names label={L.linkLabel!} value={l.label} locales={locales} max={40} onChange={(label) => put({ ...l, label })} />
                <Url label={L.url!} help={L.urlHelp!} value={l.url} onChange={(url) => put({ ...l, url })} />
              </>
            )}
          />
        </section>
      ) : null}

      {part === 'header' ? (
        <section className="flex flex-col gap-3" aria-label={L.part_header}>
          <p className="text-sm">{L.headerHelp}</p>
          <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-2">
            <Pick label={L.mark!} value={site.header.mark} options={[{ value: 'initials', label: L.mark_initials! }, { value: 'none', label: L.mark_none! }]} onChange={(mark) => set('header', { ...site.header, mark })} />
            {site.header.mark === 'initials' ? (
              <label className="flex flex-col gap-1">
                <span className="label">{L.initials}</span>
                <input className="input" maxLength={4} value={site.header.initials} placeholder={L.initialsAuto} onChange={(e) => set('header', { ...site.header, initials: e.target.value })} />
              </label>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-4">
            <Check label={L.showTagline!} value={site.header.tagline} onChange={(tagline) => set('header', { ...site.header, tagline })} />
            <Check label={L.showUser!} value={site.header.userName} onChange={(userName) => set('header', { ...site.header, userName })} />
          </div>
        </section>
      ) : null}

      {part === 'admin' ? (
        <section className="flex flex-col gap-3" aria-label={L.part_admin}>
          <p className="text-sm">{L.adminHelp}</p>
          <Names label={L.adminTitle!} value={site.admin.title} locales={locales} max={60} onChange={(title) => set('admin', { ...site.admin, title })} />
          <Names label={L.adminSubtitle!} value={site.admin.subtitle} locales={locales} max={160} onChange={(subtitle) => set('admin', { ...site.admin, subtitle })} />
        </section>
      ) : null}

      {state.error ? (
        <p role="alert" className="error-text whitespace-pre-line">
          {state.error}
        </p>
      ) : null}
      <div className="card-footer flex-wrap">
        {confirmReset ? (
          <>
            <button type="button" className="btn btn-danger me-auto" onClick={() => (setSite(standard), setConfirmReset(false))}>
              {L.resetConfirm}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmReset(false)}>
              {L.resetCancel}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-secondary me-auto" onClick={() => setConfirmReset(true)}>
            {L.reset}
          </button>
        )}
        <Submit label={L.saveDraft!} intent="draft" />
        <Submit label={L.saveAndPublish!} intent="publish" primary />
      </div>
    </form>
  );
}
