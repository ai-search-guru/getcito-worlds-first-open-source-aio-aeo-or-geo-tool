import path from 'node:path';
import {
  Document,
  Font,
  Link,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import type { DraftBlock, DraftRun } from '@/lib/content/draftExport';
import { answerDocumentBlocks, answerTitle, type ExportAnswer } from './export';

/**
 * Export PDF on the server (CHAT-06 items 32–33, 40): the question and the
 * answer as selectable text, links clickable, tables as tables, and the
 * "Generated …" line in every page's header and footer. Inter is embedded,
 * as in the Reports PDF, so Turkish and other non-Latin-1 letters (ş, ğ, ı)
 * print: the built-in Helvetica covers WinAnsi only. Inter has no italic
 * here, so emphasis and quotes are set in grey instead.
 */

const FAMILY = 'ChatExportInter';
const TEXT = '#111827';
const MUTED = '#6b7280';
const LINK = '#2563eb';
const BORDER = '#e5e7eb';
/**
 * The body text's line height. It is set on the text, not the page: on the
 * page, react-pdf's page number (a `render` text) threw "unsupported number"
 * once a PDF passed ten pages.
 */
const LINE = 1.45;

let fontsFrom: string | null = null;

/** Inter from `dir` (public/fonts by default), registered once per server. */
function registerFonts(dir: string) {
  if (fontsFrom) return;
  fontsFrom = dir;
  Font.register({
    family: FAMILY,
    fonts: [
      { src: path.join(dir, 'Inter-Regular.ttf'), fontWeight: 400 },
      { src: path.join(dir, 'Inter-Bold.ttf'), fontWeight: 700 },
    ],
  });
  // Word-splitting hyphenation looks broken in tables; wrap whole words only.
  Font.registerHyphenationCallback((word) => [word]);
}

const styles = StyleSheet.create({
  page: {
    fontFamily: FAMILY,
    fontSize: 10,
    color: TEXT,
    paddingTop: 56,
    paddingHorizontal: 48,
    paddingBottom: 56,
  },
  header: { position: 'absolute', top: 24, left: 48, right: 48, fontSize: 8, color: MUTED },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 48,
    right: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: MUTED,
  },
  h1: { fontSize: 16, fontWeight: 700, lineHeight: LINE, marginBottom: 10 },
  h2: { fontSize: 13, fontWeight: 700, lineHeight: LINE, marginTop: 8, marginBottom: 6 },
  h3: { fontSize: 11, fontWeight: 700, lineHeight: LINE, marginTop: 6, marginBottom: 4 },
  paragraph: { lineHeight: LINE, marginBottom: 6 },
  quote: {
    marginBottom: 6,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: BORDER,
    color: MUTED,
  },
  item: { flexDirection: 'row', marginBottom: 3 },
  marker: { width: 16, lineHeight: LINE },
  itemText: { flex: 1, lineHeight: LINE },
  line: { lineHeight: LINE },
  table: { marginBottom: 8, borderTopWidth: 1, borderLeftWidth: 1, borderColor: BORDER },
  row: { flexDirection: 'row' },
  cell: {
    flex: 1,
    padding: 4,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: BORDER,
    fontSize: 9,
  },
  bold: { fontWeight: 700 },
  muted: { color: MUTED },
  link: { color: LINK, textDecoration: 'underline' },
});

function runs(list: DraftRun[], bold = false) {
  return list.map((run, i) => {
    if (run.break) return '\n';
    const style = [
      ...(run.bold || bold ? [styles.bold] : []),
      ...(run.italics ? [styles.muted] : []),
    ];
    return run.link ? (
      <Link key={i} src={run.link} style={[...style, styles.link]}>
        {run.text}
      </Link>
    ) : (
      <Text key={i} style={style}>
        {run.text}
      </Text>
    );
  });
}

function Block({ block }: { block: DraftBlock }) {
  switch (block.kind) {
    case 'heading':
      return (
        <Text style={block.level === 1 ? styles.h1 : block.level === 2 ? styles.h2 : styles.h3}>
          {runs(block.runs)}
        </Text>
      );
    case 'paragraph':
      return <Text style={styles.paragraph}>{runs(block.runs)}</Text>;
    case 'quote':
      return (
        <View style={styles.quote}>
          {block.paragraphs.map((p, i) => (
            <Text key={i} style={styles.line}>
              {runs(p)}
            </Text>
          ))}
        </View>
      );
    case 'item':
      return (
        <View style={[styles.item, { marginLeft: block.level * 16 }]} wrap={false}>
          <Text style={styles.marker}>{block.ordered ? `${block.n}.` : '•'}</Text>
          <Text style={styles.itemText}>{runs(block.runs)}</Text>
        </View>
      );
    case 'table':
      return (
        <View style={styles.table}>
          {block.rows.map((row, r) => (
            <View key={r} style={styles.row} wrap={false}>
              {row.cells.map((cell, c) => (
                <View key={c} style={styles.cell}>
                  <Text style={styles.line}>{runs(cell, row.header)}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      );
    case 'html':
      return (
        <>
          {block.blocks.map((child, i) => (
            <Block key={i} block={child} />
          ))}
        </>
      );
  }
}

/**
 * The most table rows and other blocks one PDF lays out. react-pdf's time
 * grows with the square of the length (about 14 s for 1,000 table rows,
 * 60 s for 2,000), and an exported chat can hold many 200,000-character
 * answers: past this, the PDF stops with a line saying so, and the
 * Markdown and Word files keep all of it.
 */
export const PDF_BLOCK_LIMIT = 1_000;

/** The blocks a PDF lays out, `limit` at most (a table's rows each count), and whether any were left out. */
export function pdfBlocks(
  blocks: DraftBlock[],
  limit: number = PDF_BLOCK_LIMIT,
): { blocks: DraftBlock[]; cut: boolean } {
  let left = limit;
  let cut = false;
  const take = (list: DraftBlock[]): DraftBlock[] => {
    const kept: DraftBlock[] = [];
    for (const block of list) {
      if (left <= 0) {
        cut = true;
        break;
      }
      if (block.kind === 'table') {
        if (block.rows.length > left) cut = true;
        kept.push({ ...block, rows: block.rows.slice(0, left) });
        left -= Math.min(left, block.rows.length);
      } else if (block.kind === 'html') {
        kept.push({ ...block, blocks: take(block.blocks) });
      } else {
        kept.push(block);
        left -= 1;
      }
    }
    return kept;
  };
  return { blocks: take(blocks), cut };
}

export function AnswerPdfDocument({ answer }: { answer: ExportAnswer }) {
  const { blocks, cut } = pdfBlocks(answerDocumentBlocks(answer));
  return (
    <Document title={answerTitle(answer) || undefined}>
      <Page size="A4" style={styles.page}>
        <Text fixed style={styles.header}>
          {answer.stamp}
        </Text>
        {blocks.map((block, i) => (
          <Block key={i} block={block} />
        ))}
        {cut && (
          <Text style={[styles.paragraph, styles.muted]}>
            The PDF stops here: it is too long for one. The Markdown and Word downloads have all of
            it.
          </Text>
        )}
        <View fixed style={styles.footer}>
          <Text>{answer.stamp}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Export PDF. `fontDir` holds Inter-Regular.ttf and Inter-Bold.ttf: public/fonts by default. */
export async function answerPdf(
  answer: ExportAnswer,
  fontDir: string = path.join(process.cwd(), 'public', 'fonts'),
): Promise<Uint8Array> {
  registerFonts(fontDir);
  return new Uint8Array(await renderToBuffer(<AnswerPdfDocument answer={answer} />));
}
