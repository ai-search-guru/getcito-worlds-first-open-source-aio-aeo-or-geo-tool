import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  opportunityCsv,
  opportunityDocx,
  opportunityExportFileName,
  opportunityRows,
  opportunityWorkbook,
} from './opportunityExport';
import type { OpportunityDocument } from './opportunityMarkdown';

const doc: OpportunityDocument = {
  title: 'Office coffee subscriptions for teams',
  description: 'Rivals rank first for "office coffee".',
  sections: [
    {
      title: null,
      lines: [
        { kind: 'field', label: 'Type', value: 'Owned' },
        { kind: 'field', label: 'Score', value: '75' },
      ],
    },
    { title: 'Target pages', lines: [{ kind: 'item', text: 'Pricing: https://acme.example/p' }] },
    {
      title: 'Brief outline',
      lines: [{ kind: 'step', n: 1, text: 'Why teams switch', points: ['Cost', 'Choice'] }],
    },
    {
      title: 'Competitor insights',
      lines: [{ kind: 'text', text: 'Rivals list prices, we don’t.' }],
    },
  ],
};

describe('opportunityRows', () => {
  it('puts every line under its section, the opening facts under Overview', () => {
    expect(opportunityRows(doc)).toEqual([
      { section: 'Overview', field: 'Title', value: 'Office coffee subscriptions for teams' },
      {
        section: 'Overview',
        field: 'Description',
        value: 'Rivals rank first for "office coffee".',
      },
      { section: 'Overview', field: 'Type', value: 'Owned' },
      { section: 'Overview', field: 'Score', value: '75' },
      { section: 'Target pages', field: '', value: 'Pricing: https://acme.example/p' },
      { section: 'Brief outline', field: '1', value: 'Why teams switch\n- Cost\n- Choice' },
      { section: 'Competitor insights', field: '', value: 'Rivals list prices, we don’t.' },
    ]);
  });
});

describe('opportunityCsv', () => {
  it('writes the rows under Section, Field and Value, quoting what needs it', () => {
    const lines = opportunityCsv(doc).split('\n');
    // The sheet's header, in the same case.
    expect(lines[0]).toBe('Section,Field,Value');
    expect(lines[2]).toBe('Overview,Description,"Rivals rank first for ""office coffee""."');
  });
});

describe('opportunityWorkbook', () => {
  it('is one sheet: a bold header, then the rows', () => {
    const [sheet] = opportunityWorkbook(doc);
    expect(sheet.sheet).toBe('Opportunity');
    expect(sheet.data[0]).toEqual([
      { value: 'Section', fontWeight: 'bold' },
      { value: 'Field', fontWeight: 'bold' },
      { value: 'Value', fontWeight: 'bold' },
    ]);
    expect(sheet.data).toHaveLength(8);
    expect(sheet.data[3]).toEqual(['Overview', 'Type', 'Owned']);
    // An outline step and its points wrap, so Excel shows them on their lines.
    expect(sheet.data.find((row) => row[0] === 'Brief outline')![2]).toEqual({
      value: 'Why teams switch\n- Cost\n- Choice',
      wrap: true,
    });
  });
});

describe('opportunityDocx', () => {
  it('writes a Word document with the title, headings, fields and lists', async () => {
    const blob = await opportunityDocx(doc);
    // jsdom's Blob has no arrayBuffer(): read it as a browser's FileReader would.
    const bytes = await new Promise<Uint8Array>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(blob);
    });
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    for (const text of [
      'Office coffee subscriptions for teams',
      'Target pages',
      'Type: ',
      'Owned',
      '1. Why teams switch',
      'Choice',
      'Rivals list prices, we don’t.',
    ]) {
      expect(xml).toContain(text);
    }
  });
});

describe('opportunityDocx with a white label kit', () => {
  it('names the kit’s company as the author', async () => {
    const blob = await opportunityDocx(doc, 'Acme Agency');
    const bytes = await new Promise<Uint8Array>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(blob);
    });
    expect(strFromU8(unzipSync(bytes)['docProps/core.xml'])).toContain(
      '<dc:creator>Acme Agency</dc:creator>',
    );
  });
});

describe('opportunityExportFileName', () => {
  it('names the file after the opportunity', () => {
    expect(opportunityExportFileName(doc, 'docx')).toBe(
      'getcito_opportunity_office-coffee-subscriptions-for-teams.docx',
    );
    expect(opportunityExportFileName({ ...doc, title: '—' }, 'csv')).toBe(
      'getcito_opportunity_export.csv',
    );
  });

  it('starts with a white label kit’s word instead, or none', () => {
    expect(opportunityExportFileName({ ...doc, title: 'Beans' }, 'xlsx', 'acme-agency')).toBe(
      'acme-agency_opportunity_beans.xlsx',
    );
    expect(opportunityExportFileName({ ...doc, title: 'Beans' }, 'csv', null)).toBe(
      'opportunity_beans.csv',
    );
  });
});
