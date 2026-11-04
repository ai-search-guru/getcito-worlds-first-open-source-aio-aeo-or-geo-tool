import { describe, expect, it } from 'vitest';
import { DEFAULTS, estimatedCardUsd, reportCardLimits, reportCardOrigins } from './config.js';
import { countryLanguage, countryName, isCountry, languageName } from './countries.js';

describe('reportCardLimits', () => {
  it('falls back to 200 a day, $200 a month, 30 days and 5 an hour', () => {
    expect(reportCardLimits({})).toEqual({ ...DEFAULTS });
    expect(DEFAULTS).toMatchObject({
      dailyCap: 200,
      monthlyBudgetUsd: 200,
      repeatDays: 30,
      ipHourly: 5,
    });
  });

  it('reads each from the environment, and ignores what isn’t a number', () => {
    const limits = reportCardLimits({
      REPORT_CARD_DAILY_CAP: '50',
      REPORT_CARD_MONTHLY_BUDGET_USD: '75.5',
      REPORT_CARD_REPEAT_DAYS: 'soon',
      REPORT_CARD_IP_HOURLY: '-3',
      REPORT_CARD_CONCURRENCY: '0',
    });
    expect(limits).toMatchObject({
      dailyCap: 50,
      monthlyBudgetUsd: 75.5,
      repeatDays: 30,
      ipHourly: 5,
      concurrency: 1,
    });
  });

  it('expects a card to cost about a third of a dollar', () => {
    expect(estimatedCardUsd(reportCardLimits({}))).toBeCloseTo(0.325, 3);
  });
});

describe('reportCardOrigins', () => {
  it('is www.getcito.com and getcito.com unless set', () => {
    expect(reportCardOrigins({})).toEqual(['https://www.getcito.com', 'https://getcito.com']);
    expect(
      reportCardOrigins({ REPORT_CARD_ORIGINS: 'https://www.getcito.com/, https://x.webflow.io' }),
    ).toEqual(['https://www.getcito.com', 'https://x.webflow.io']);
  });
});

describe('countries', () => {
  it('knows a country by its code, with its English name and main language', () => {
    expect(isCountry('TR')).toBe(true);
    expect(isCountry('US')).toBe(true);
    expect(isCountry('ZZ')).toBe(false);
    expect(isCountry('EU')).toBe(false);
    expect(isCountry('XK')).toBe(true);
    expect(isCountry('tr')).toBe(false);
    expect(countryName('US')).toBe('United States');
    expect(countryName('TR')).toMatch(/^T(ü|u)rk/);
    expect(countryLanguage('TR')).toBe('tr');
    expect(countryLanguage('US')).toBe('en');
    expect(countryLanguage('DE')).toBe('de');
    expect(languageName('tr')).toBe('Turkish');
  });

  it('asks in English where no main language is named', () => {
    expect(countryLanguage('IN')).toBe('en');
    expect(countryLanguage('NG')).toBe('en');
  });
});
