/**
 * An output's time line (CHAT-06 items 38–42): "Generated Oct 26, 2026 ·
 * 09:14", "Data as of …" when workspace data was read, in the time zone it
 * was shown in, with the GMT offset for the tooltip and the files. One
 * place for the answer, the result card and the downloads.
 */

/** "Oct 26, 2026", "14:32", "Oct 26" and the GMT offset of an instant, in a time zone. */
export function stampParts(iso: string, timeZone?: string) {
  const at = new Date(iso);
  const date = at.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  });
  const day = at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone });
  const time = at.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  });
  const offset =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value ?? '';
  return { date, day, time, offset };
}

/** Words for the line, from chatRun.resultCard (generatedTip, dataAsOfTip). */
type StampWords = (key: 'generatedTip' | 'dataAsOfTip', values: { full: string }) => string;

/**
 * The line a downloaded file carries (item 40): "Generated Oct 26, 2026 ·
 * 09:14 GMT+3 · Data as of Oct 26, 2026 · 06:00 GMT+3", from the stored
 * times, never the download's.
 */
export function fileStamp(
  t: StampWords,
  generatedAt: string,
  dataAsOf: string | null,
  timeZone?: string | null,
): string {
  const zone = timeZone ?? undefined;
  const at = stampParts(generatedAt, zone);
  const line = t('generatedTip', { full: `${at.date} · ${at.time} ${at.offset}` });
  if (!dataAsOf) return line;
  const asOf = stampParts(dataAsOf, zone);
  return `${line} · ${t('dataAsOfTip', { full: `${asOf.date} · ${asOf.time} ${asOf.offset}` })}`;
}
