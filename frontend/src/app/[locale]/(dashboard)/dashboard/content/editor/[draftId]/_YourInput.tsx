'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, ShieldCheck, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MAX_ATTACHMENT_BYTES, tableRows } from '@/lib/content/attachments';
import {
  MAX_GETCITO_DATA,
  MAX_DATA_TABLES,
  MAX_EXPERIENCE,
  MAX_QUOTES,
  MAX_QUOTES_BYTES,
  jsonbBytes,
  keptRows,
  pastedRows,
  quoteSchema,
  tableThatFits,
  type DraftInputs,
  type InputQuote,
} from '@/lib/content/draftInputs';
import { SOURCES_DAYS } from '@/lib/content/sources';
import { cellsToText, parseCsv } from '@/lib/promptImport';
import type { InputsUpdate } from './_useDraftInputs';

/** Where Quality's "Add" to-dos scroll to. */
export const YOUR_INPUT_ID = 'your-input';

/** A tracked prompt of the draft, as Sources reads it: its answers and the brand's mentions. */
export interface InputPrompt {
  id: string;
  text: string;
  answers: number;
  mentioned: number;
}

const EMPTY_QUOTE: InputQuote = { name: '', title: '', text: '', sourceUrl: '' };

/** A day, "2026-10-24", as its month and year: how GetCito data is cited. */
const monthOf = (day: string) => new Date(`${day.slice(0, 7)}-01T12:00:00Z`);

/**
 * Brief › Your input (Content Editor Quality spec §6, CE-048), at the top
 * of Brief: what only the person can give, used only as they write it.
 * Their experience; their data, from GetCito (a prompt's answers and the
 * brand's mentions, cited as "GetCito data, {month year}") or from a CSV
 * or Excel file read here in the browser, or pasted; expert quotes, each
 * with the four things that make it real. Under it, what the agent never
 * does. Each change is kept at once (`onChange`, made to the input as it
 * is then: a file read meanwhile doesn't undo another change); the
 * experience on Save, or when the person leaves its box.
 */
export function YourInput({
  inputs,
  prompts,
  onChange,
  scrollRequest = null,
}: {
  inputs: DraftInputs;
  /** The draft's prompts, those it targets first: GetCito data offered from them. */
  prompts: InputPrompt[];
  onChange: (update: InputsUpdate) => void;
  /** A Quality "Add" (a new number each time), with Brief showing: the block scrolls into view. */
  scrollRequest?: number | null;
}) {
  const t = useTranslations('contentEditor.editor.yourInput');
  const format = useFormatter();
  const [experience, setExperience] = useState(inputs.experience);
  const [pasted, setPasted] = useState('');
  const [quote, setQuote] = useState<InputQuote>(EMPTY_QUOTE);
  const fileRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  // Each Add scrolls once: not again when Brief is opened later.
  const scrolled = useRef<number | null>(null);
  useEffect(() => {
    if (scrollRequest === null || scrolled.current === scrollRequest) return;
    scrolled.current = scrollRequest;
    sectionRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [scrollRequest]);
  const keepExperience = () => {
    const next = experience.trim();
    onChange((current) =>
      next === current.experience ? current : { ...current, experience: next },
    );
  };
  const monthLabel = (day: string) =>
    format.dateTime(monthOf(day), { month: 'long', year: 'numeric' });
  const used = new Set(inputs.getcitoData.map((d) => d.promptId));
  const offered = prompts.filter((p) => p.answers > 0 && !used.has(p.id));
  const tablesFull = inputs.data.length >= MAX_DATA_TABLES;

  const addTable = (name: string, rows: string[][]) => {
    const kept = keptRows(tableRows(rows));
    if (!kept.length) {
      toast.error(t('data.empty', { name }));
      return;
    }
    onChange((current) => {
      // The draft keeps its tables to the database's size: the rows that fit.
      const table = tableThatFits(current.data, { name: name.slice(0, 120), rows: kept });
      if (current.data.length >= MAX_DATA_TABLES || !table.rows.length) {
        toast.error(t('data.full'));
        return current;
      }
      if (table.rows.length < kept.length) {
        toast(t('data.trimmed', { name, count: table.rows.length }));
      }
      return { ...current, data: [...current.data, table] };
    });
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error(t('data.tooLarge', { name: file.name }));
      return;
    }
    if (/\.xlsx$/i.test(file.name)) {
      // Loaded on demand, as Attach does: the reader is only needed when someone uploads.
      const { default: readXlsxFile } = await import('read-excel-file/browser');
      const sheets = await readXlsxFile(file).catch(() => null);
      const first = sheets?.find((sheet) => sheet.data.length > 0);
      if (!first) {
        toast.error(t('data.empty', { name: file.name }));
        return;
      }
      addTable(file.name, cellsToText(first.data as unknown[][]));
      return;
    }
    if (/\.csv$/i.test(file.name)) {
      addTable(file.name, parseCsv(await file.text()));
      return;
    }
    toast.error(t('data.unsupported', { name: file.name }));
  };

  const addQuote = () => {
    const added = quoteSchema.parse(quote);
    let kept = false;
    onChange((current) => {
      const quotes = [...current.quotes, added];
      if (quotes.length > MAX_QUOTES || jsonbBytes(quotes) > MAX_QUOTES_BYTES) {
        toast.error(t('quotes.full'));
        return current;
      }
      kept = true;
      return { ...current, quotes };
    });
    if (kept) setQuote(EMPTY_QUOTE);
  };
  const quoteReady = quoteSchema.safeParse(quote).success;

  return (
    <section
      ref={sectionRef}
      id={YOUR_INPUT_ID}
      aria-labelledby={`${YOUR_INPUT_ID}-title`}
      className="space-y-4 rounded-xl border bg-card p-3"
    >
      <h4 id={`${YOUR_INPUT_ID}-title`} className="text-sm font-medium">
        {t('title')}{' '}
        <span className="font-normal text-muted-foreground">· {t('usedAsWritten')}</span>
      </h4>

      <div className="space-y-1.5">
        <Label htmlFor="your-experience">{t('experience.label')}</Label>
        <Textarea
          id="your-experience"
          value={experience}
          maxLength={MAX_EXPERIENCE}
          placeholder={t('experience.placeholder')}
          className="min-h-20 text-sm"
          onChange={(e) => setExperience(e.target.value)}
          onBlur={keepExperience}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {t('experience.count', { count: experience.length, max: MAX_EXPERIENCE })}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={experience.trim() === inputs.experience}
            onClick={keepExperience}
          >
            {t('save')}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium">{t('data.label')}</p>
        {inputs.getcitoData.map((d) => (
          <div
            key={d.promptId}
            className="flex items-start gap-2 rounded-lg border bg-muted/40 px-2.5 py-2 text-xs"
          >
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              {t('data.getcito', {
                answers: d.answers,
                mentioned: d.mentioned,
                prompt: d.prompt,
                days: d.days,
              })}{' '}
              <span className="text-muted-foreground">
                {t('data.cited', { month: monthLabel(d.asOf) })}
              </span>
            </span>
            <button
              type="button"
              aria-label={t('removeNamed', { name: d.prompt })}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() =>
                onChange((current) => ({
                  ...current,
                  getcitoData: current.getcitoData.filter((x) => x.promptId !== d.promptId),
                }))
              }
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {inputs.getcitoData.length < MAX_GETCITO_DATA &&
          offered.slice(0, 3).map((p) => (
            <div
              key={p.id}
              className="flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs"
            >
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {t('data.offer', {
                  answers: p.answers,
                  mentioned: p.mentioned,
                  prompt: p.text,
                  days: SOURCES_DAYS,
                })}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0"
                onClick={() =>
                  onChange((current) =>
                    current.getcitoData.some((x) => x.promptId === p.id) ||
                    current.getcitoData.length >= MAX_GETCITO_DATA
                      ? current
                      : {
                          ...current,
                          getcitoData: [
                            ...current.getcitoData,
                            {
                              promptId: p.id,
                              prompt: p.text.slice(0, 500),
                              answers: p.answers,
                              mentioned: p.mentioned,
                              // The day it is used, where the person is: the
                              // numbers are the SOURCES_DAYS up to it.
                              asOf: new Date().toLocaleDateString('en-CA'),
                              days: SOURCES_DAYS,
                            },
                          ],
                        },
                  )
                }
              >
                {t('data.use')}
              </Button>
            </div>
          ))}
        {inputs.data.map((table, i) => (
          <div key={`${table.name}-${i}`} className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate">
              {table.name}{' '}
              <span className="text-muted-foreground">
                · {t('data.rows', { count: table.rows.length })}
              </span>
            </span>
            <button
              type="button"
              aria-label={t('removeNamed', { name: table.name })}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() =>
                onChange((current) => ({
                  ...current,
                  data: current.data.filter((x) => x !== table),
                }))
              }
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {!tablesFull && (
          <div className="space-y-1.5">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                void readFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              {t('data.upload')}
            </Button>
            <Textarea
              aria-label={t('data.paste')}
              value={pasted}
              placeholder={t('data.paste')}
              className="min-h-14 text-xs"
              onChange={(e) => setPasted(e.target.value)}
            />
            {pasted.trim() && (
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => {
                  addTable(t('data.pastedName'), pastedRows(pasted));
                  setPasted('');
                }}
              >
                {t('data.addPasted')}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium">{t('quotes.label')}</p>
        {inputs.quotes.map((q, i) => (
          <figure key={`${q.name}-${i}`} className="flex items-start gap-2 text-xs">
            <div className="min-w-0 flex-1 space-y-0.5">
              <blockquote className="[overflow-wrap:anywhere]">“{q.text}”</blockquote>
              <figcaption className="text-muted-foreground [overflow-wrap:anywhere]">
                {q.name}, {q.title} ·{' '}
                <a
                  href={q.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {t('quotes.source')}
                </a>
              </figcaption>
            </div>
            <button
              type="button"
              aria-label={t('removeNamed', { name: q.name })}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() =>
                onChange((current) => ({
                  ...current,
                  quotes: current.quotes.filter((x) => x !== q),
                }))
              }
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </figure>
        ))}
        {inputs.quotes.length < MAX_QUOTES && (
          <div className="grid gap-1.5">
            <Input
              aria-label={t('quotes.name')}
              placeholder={t('quotes.name')}
              value={quote.name}
              onChange={(e) => setQuote({ ...quote, name: e.target.value })}
            />
            <Input
              aria-label={t('quotes.title')}
              placeholder={t('quotes.title')}
              value={quote.title}
              onChange={(e) => setQuote({ ...quote, title: e.target.value })}
            />
            <Textarea
              aria-label={t('quotes.text')}
              placeholder={t('quotes.text')}
              value={quote.text}
              className="min-h-14 text-xs"
              onChange={(e) => setQuote({ ...quote, text: e.target.value })}
            />
            <Input
              aria-label={t('quotes.sourceUrl')}
              placeholder={t('quotes.sourceUrl')}
              value={quote.sourceUrl}
              onChange={(e) => setQuote({ ...quote, sourceUrl: e.target.value })}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">{t('quotes.realOnly')}</span>
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                disabled={!quoteReady}
                onClick={addQuote}
              >
                {t('quotes.add')}
              </Button>
            </div>
          </div>
        )}
      </div>

      <p className="flex items-start gap-2 rounded-lg bg-foreground px-3 py-2 text-xs text-background">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{t('guard')}</span>
      </p>
    </section>
  );
}
