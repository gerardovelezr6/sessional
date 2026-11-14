import { ConfirmButton } from '@/components/ConfirmButton';
import type { Grading } from '@/grading/schema';
import type { Mapping } from '@/grading/server';
import { awardSuggestions, formatPoints, standingsOf, type GradingData } from '@/grading/standings';
import { localize, type Translate } from '@/messages';
import { removeGradeFromLogAction, setAwardAction } from '../../grades/actions';
import { AwardsForm } from './AwardsForm';

// A committee's gradebook: totals, awards, every grade given, and downloads.
export function GradesTab({ tenantKey, base, data, rules, mappings, canGrade, locale, timeZone, t }: { tenantKey: string; base: string; data: GradingData; rules: Grading; mappings: Mapping[]; canGrade: boolean; locale: string; timeZone: string; t: Translate }) {
  const standings = standingsOf(rules, data, locale);
  const suggestions = awardSuggestions(rules, standings);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short', timeZone });
  const numberOf = new Map(data.sessions.map((s) => [s.id, s.number]));
  const committeeId = data.committee.id;
  return (
    <div className="flex flex-col gap-6">
      <section className="card flex flex-col gap-3" aria-labelledby="standings-title">
        <h2 id="standings-title" className="text-lg font-bold text-on-surface">
          {t('grades.standings')}
        </h2>
        {standings.length === 0 ? <p className="text-sm">{t('grades.none')}</p> : null}
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm" aria-labelledby="standings-title">
            <thead>
              <tr className="border-b border-border-strong">
                <th scope="col" className="p-2 text-start">{t('grades.col.rank')}</th>
                <th scope="col" className="p-2 text-start">{t('grades.col.label')}</th>
                {data.sessions.map((s) => (
                  <th key={s.id} scope="col" className="p-2 text-end">
                    {t('grades.col.sessionShort', { number: s.number })}
                  </th>
                ))}
                {rules.bonuses.map((b) => (
                  <th key={b.key} scope="col" className="p-2 text-end">
                    {localize(b.name, locale, b.key)}
                  </th>
                ))}
                <th scope="col" className="p-2 text-end">{t('grades.col.total')}</th>
                {rules.scale.kind !== 'points' ? <th scope="col" className="p-2 text-end">{t('grades.col.shown')}</th> : null}
                <th scope="col" className="p-2 text-start">{t('grades.col.awards')}</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s) => (
                <tr key={s.delegateId} className="border-b border-border">
                  <td className="p-2">{s.rank}</td>
                  <td className="p-2 font-semibold text-on-surface">{s.label}</td>
                  {data.sessions.map((x) => (
                    <td key={x.id} className="p-2 text-end font-mono">
                      {formatPoints(s.bySession[x.id] ?? 0)}
                    </td>
                  ))}
                  {rules.bonuses.map((b) => (
                    <td key={b.key} className="p-2 text-end font-mono">
                      {formatPoints(s.byBonus[b.key] ?? 0)}
                    </td>
                  ))}
                  <td className="p-2 text-end font-mono font-bold text-on-surface">{formatPoints(s.total)}</td>
                  {rules.scale.kind !== 'points' ? <td className="p-2 text-end font-bold text-on-surface">{s.shown}</td> : null}
                  <td className="p-2">{s.awards.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {rules.awards.length ? (
        <section className="card flex flex-col gap-3" aria-labelledby="awards-title">
          <h2 id="awards-title" className="text-lg font-bold text-on-surface">
            {t('grades.awards')}
          </h2>
          <p className="text-sm">{t('grades.awards.help')}</p>
          {canGrade ? (
            <AwardsForm
              awards={rules.awards.map((a) => ({ key: a.key, name: localize(a.name, locale, a.key), count: a.count, current: data.awards.filter((x) => x.award === a.key && x.delegate_id).map((x) => x.delegate_id!), suggested: suggestions[a.key] ?? [] }))}
              delegates={data.delegates.map((d) => ({ id: d.id, label: d.label }))}
              save={setAwardAction.bind(null, tenantKey, committeeId)}
              after={`${base}/committees/${committeeId}?tab=grades&done=award`}
              L={{ title: t('grades.awards'), suggested: t('grades.awards.suggested'), useSuggestion: t('grades.awards.useSuggestion'), nobody: t('grades.awards.nobody'), save: t('grades.awards.save'), error_invalid: t('grades.awards.error.invalid'), error_forbidden: t('committees.error.forbidden'), error_failed: t('committees.error.failed') }}
            />
          ) : (
            <ul className="text-sm">
              {rules.awards.map((a) => (
                <li key={a.key}>
                  <span className="font-semibold text-on-surface">{localize(a.name, locale, a.key)}:</span> {data.awards.filter((x) => x.award === a.key).map((x) => x.label).join(', ') || '—'}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="card flex flex-col gap-3" aria-labelledby="export-title">
        <h2 id="export-title" className="text-lg font-bold text-on-surface">
          {t('grades.export')}
        </h2>
        <form method="get" action={`${base}/grades/export`} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="committee" value={committeeId} />
          <label className="flex flex-col gap-1">
            <span className="label">{t('grades.export.format')}</span>
            <select className="input" name="format" defaultValue="xlsx">
              <option value="xlsx">{t('grades.format.xlsx')}</option>
              <option value="csv">{t('grades.format.csv')}</option>
              <option value="pdf">{t('grades.format.pdf')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">{t('grades.export.columns')}</span>
            <select className="input" name="mapping" defaultValue="">
              <option value="">{t('grades.export.allColumns')}</option>
              {mappings.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-primary">
            {t('grades.export.download')}
          </button>
        </form>
      </section>

      <section id="log" className="card flex flex-col gap-3" aria-labelledby="log-title">
        <h2 id="log-title" className="text-lg font-bold text-on-surface">
          {t('grades.log')}
        </h2>
        {data.grades.length === 0 ? <p className="text-sm">{t('grades.none')}</p> : null}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-labelledby="log-title">
            <thead>
              <tr className="border-b border-border-strong">
                <th scope="col" className="p-2 text-start">{t('grades.log.when')}</th>
                <th scope="col" className="p-2 text-start">{t('grades.log.session')}</th>
                <th scope="col" className="p-2 text-start">{t('grades.col.label')}</th>
                <th scope="col" className="p-2 text-start">{t('grades.log.category')}</th>
                <th scope="col" className="p-2 text-start">{t('grades.log.level')}</th>
                <th scope="col" className="p-2 text-end">{t('grades.log.points')}</th>
                <th scope="col" className="p-2 text-start">{t('grades.log.note')}</th>
                <th scope="col" className="p-2 text-start">{t('grades.log.by')}</th>
                {canGrade ? <th scope="col" className="p-2"><span className="sr-only">{t('grades.log.actions')}</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {[...data.grades].reverse().map((g) => (
                <tr key={g.id} className="border-b border-border">
                  <td className="whitespace-nowrap p-2">{when.format(new Date(g.graded_at))}</td>
                  <td className="p-2">{g.session_id ? numberOf.get(g.session_id) : '—'}</td>
                  <td className="p-2 font-semibold text-on-surface">{g.label}</td>
                  <td className="p-2">{localize(g.category_name, locale, g.category)}</td>
                  <td className="p-2">{localize(g.level_label, locale, g.level)}</td>
                  <td className="p-2 text-end font-mono">{formatPoints(Number(g.points) * Number(g.weight))}</td>
                  <td className="p-2">{g.note}</td>
                  <td className="p-2">{g.graded_by}</td>
                  {canGrade ? (
                    <td className="p-2">
                      <ConfirmButton action={removeGradeFromLogAction.bind(null, tenantKey, committeeId, g.id)} ask={t('grading.remove')} askName={t('grades.log.removeOne', { who: g.label })} confirm={t('grading.removeConfirm')} cancel={t('grading.keep')} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
