import { describe, expect, it } from 'vitest';
import { resolveCountry } from '@/i18n/countries';

// Formal names as schools list their delegations.
describe('formal country names', () => {
  it('are recognised', () => {
    const cases: Record<string, string> = {
      "Democratic People's Republic of Korea": 'KP', 'Italian Republic': 'IT', 'Republic of Indonesia': 'ID', 'Swiss Confederation': 'CH', Ukraine: 'UA',
      'United Mexican States': 'MX', 'Arab Republic of Egypt': 'EG', 'Hashemite Kingdom of Jordan': 'JO', 'Islamic Republic of Pakistan': 'PK',
      'Islamic Republic of Afghanistan': 'AF', 'Kingdom of Bahrain': 'BH', 'Republic of the Sudan': 'SD', 'Republic of Turkey': 'TR', 'State of Qatar': 'QA',
      'Federal Republic of Germany': 'DE', 'Republic of Lebanon': 'LB', 'Lebanese Republic': 'LB', 'State of Palestine': 'PS', 'Peoples Republic of China': 'CN',
      "People's Republic of China": 'CN', 'Republic of China': 'TW', 'Republic of Korea': 'KR', 'Czech Republic': 'CZ', 'Belarus': 'BY', 'Hungary': 'HU',
      'Kingdom of Saudi Arabia': 'SA', 'Portuguese Republic': 'PT', 'Kingdom of Spain': 'ES', 'Republic of Bulgaria': 'BG', 'Romania': 'RO',
      'Russian Federation': 'RU', 'State of Israel': 'IL', 'Syrian Arab Republic': 'SY', 'United States of America': 'US', 'Republic of Iraq': 'IQ',
      'United Kingdom of Great Britain and Northern Ireland': 'GB', 'Democratic Republic of the Congo': 'CD', 'Republic of the Congo': 'CG',
      'Commonwealth of Dominica': 'DM', 'Dominican Republic': 'DO', 'Federal Democratic Republic of Ethiopia': 'ET', 'Oriental Republic of Uruguay': 'UY',
      'Kyrgyz Republic': 'KG', 'Slovak Republic': 'SK', 'Grand Duchy of Luxembourg': 'LU', 'Union of the Comoros': 'KM', 'Togolese Republic': 'TG',
    };
    for (const [name, code] of Object.entries(cases)) expect(resolveCountry(name), name).toBe(code);
  });
  it('do not match what is not a country', () => {
    for (const name of ['Republic of Polan', 'Minister of Defence', 'Secretary of State', 'Head of the Fleet']) expect(resolveCountry(name), name).toBeNull();
  });
});
