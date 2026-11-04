import { describe, expect, it } from 'vitest';
import { checkDateOnPage, checkDateText, isCheckDateLine, pageCheckDate } from './checkDate';
import { isByline } from './readability';

/** A comparison's visible check date (Quality spec §11, CE-052). */

const NOW = new Date('2026-10-25T12:00:00Z');

describe('checkDateText', () => {
  it('says this month in the page’s language, none for a language without a line', () => {
    expect(checkDateText('English (US)', NOW)).toBe('Last checked: October 2026');
    expect(checkDateText('tr', NOW)).toBe('Son kontrol: Ekim 2026');
    expect(checkDateText('de', NOW)).toBe('Zuletzt geprüft: Oktober 2026');
    expect(checkDateText('Japanese', NOW)).toBeNull();
  });

  it('is read back in every language, and Answer first reads past it as a date', () => {
    for (const language of ['en', 'tr', 'de', 'fr', 'es', 'pt', 'it', 'nl', 'sv']) {
      const line = checkDateText(language, NOW)!;
      expect(pageCheckDate([line], NOW)).toBe(true);
      expect(isByline(line)).toBe(true);
    }
  });
});

describe('pageCheckDate', () => {
  it('reads a check date from the last two years, as a verb or a label', () => {
    for (const text of [
      'We tested each tool in March 2025.',
      'Last update: October 2026',
      'Son güncelleme: Ekim 2026',
      'İncelendi: Ekim 2026',
      'Letzte Aktualisierung: Oktober 2026',
      'Dernière mise à jour : octobre 2026',
      'Última actualización: octubre de 2026',
      'Ultimo aggiornamento: ottobre 2026',
      'Letzte Prüfung: Oktober 2026',
      'Actualisé le 3 octobre 2026',
      'Testato a ottobre 2026',
      'Last modified: October 2026',
      'Verificado en octubre de 2026',
    ]) {
      expect(pageCheckDate([text], NOW), text).toBe(true);
    }
  });

  it('reads none from an old date, a year with no check, a word inside another, or a check far from its year', () => {
    for (const text of [
      'Last checked: May 2021.',
      'Founded in 2026 by two engineers.',
      'We checked every plan.',
      'Areas of improvement for 2026.',
      'Untested before 2026.',
      // Words that aren't a check: a verification, updates, a control.
      'Email verification since 2025.',
      'Free updates since 2025.',
      "Ebeveyn kontrolü 2025'te geldi.",
      'We tested a dozen tools for this guide, comparing price, speed, support and integrations for small teams; Acme launched in 2026.',
    ]) {
      expect(pageCheckDate([text], NOW), text).toBe(false);
    }
  });

  it('tells Add line’s own line at any year, for it to replace, and no one else’s date (#1495 review)', () => {
    for (const language of ['en', 'tr', 'de', 'fr', 'es', 'pt', 'it', 'nl', 'sv']) {
      expect(isCheckDateLine(checkDateText(language, new Date('2021-05-10'))!), language).toBe(
        true,
      );
    }
    for (const text of [
      'By Jane Doe · Updated March 2023',
      'We tested 9 CRMs in 2024; HubSpot fits small teams best.',
      'Acme updated its pricing in 2023, and the Pro plan now costs more.',
      'Last checked: May 2021, by our team.',
      'Our pick for small teams.',
    ]) {
      expect(isCheckDateLine(text), text).toBe(false);
    }
  });
});

describe('checkDateOnPage', () => {
  it('tells a recent date, an old line Add line replaces, and an old date in the person’s words', () => {
    expect(checkDateOnPage(['Last checked: October 2026'], NOW)).toEqual({
      found: true,
      old: null,
    });
    expect(checkDateOnPage(['Last checked: May 2021'], NOW)).toEqual({ found: false, old: 'line' });
    expect(checkDateOnPage(['By Jane Doe · Updated March 2023'], NOW)).toEqual({
      found: false,
      old: 'text',
    });
    expect(checkDateOnPage(['Our pick for small teams.'], NOW)).toEqual({
      found: false,
      old: null,
    });
  });
});
