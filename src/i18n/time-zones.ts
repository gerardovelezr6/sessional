// Time zones grouped by region, each labelled with its city and current offset from UTC.
export interface ZoneGroup {
  label: string;
  zones: { value: string; label: string }[];
}

const cache = new Map<string, ZoneGroup[]>();

export function timeZoneGroups(locale: string, now = new Date()): ZoneGroup[] {
  const hit = cache.get(locale);
  if (hit) return hit;
  const groups = new Map<string, ZoneGroup['zones']>();
  for (const zone of ['UTC', ...Intl.supportedValuesOf('timeZone')]) {
    const region = zone.includes('/') ? zone.split('/')[0]! : 'UTC';
    let offset = '';
    try {
      offset = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? '';
    } catch {
      offset = '';
    }
    const city = zone.split('/').slice(1).join(' / ').replaceAll('_', ' ') || zone;
    const list = groups.get(region) ?? [];
    list.push({ value: zone, label: offset ? `${city} (${offset})` : city });
    groups.set(region, list);
  }
  const out = [...groups.entries()].map(([label, zones]) => ({ label, zones: zones.sort((a, b) => a.label.localeCompare(b.label)) }));
  cache.set(locale, out);
  return out;
}
