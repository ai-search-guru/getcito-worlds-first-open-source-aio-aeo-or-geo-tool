import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { parseTaskDetails } from '@/lib/action-center/taskDetails';
import { TaskDetailForm, TaskDetailView, TaskTypeBadge } from './TaskDetail';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Types into a field the way a person does, so React's onChange runs. */
function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(field) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value);
  act(() => {
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const field = (label: string) => {
  const target = [...container.querySelectorAll('label')].find((l) =>
    l.textContent?.startsWith(label),
  );
  return container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[id="${target?.getAttribute('for')}"]`,
  )!;
};

const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === name)!;

const details = parseTaskDetails({
  where: 'acme.example/blog/best-tools · 3 prompts on ChatGPT',
  why: 'Cited #2 until Oct 8.',
  how: ['Add a feature table.', 'Put "2026" in the title.'],
  doneWhen: 'Cited again on 2 of 3 platforms within 14 days.',
  type: 'content',
  effort: '~2h',
  role: 'Content writer',
});

describe('TaskDetailView', () => {
  it('shows where, why, the steps in order, done-when and the effort', () => {
    render(<TaskDetailView details={details} disabled={false} onEdit={() => {}} />);
    const terms = [...container.querySelectorAll('dt')].map((dt) => dt.textContent);
    expect(terms).toEqual(['Where', 'Why', 'How', 'Done when', 'Effort']);
    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Add a feature table.',
      'Put "2026" in the title.',
    ]);
    expect(container.textContent).toContain('~2h · Content writer');
  });

  it('shows the exact page, the change and how it is checked (AC-010)', () => {
    render(
      <TaskDetailView
        details={parseTaskDetails({
          url: 'https://acme.example/blog/best-tools',
          where: 'acme.example/blog/best-tools',
          change: { before: 'Our tools', after: 'The 2026 tools, compared' },
          doneWhen: 'H2 present · answer under 60 words · page re-fetched',
          check: 'auto',
        })}
        disabled={false}
        onEdit={() => {}}
      />,
    );
    const terms = [...container.querySelectorAll('dt')].map((dt) => dt.textContent);
    expect(terms).toEqual(['URL', 'Where', 'Change', 'Done when', 'How we check']);
    // A full URL opens the page.
    expect(container.querySelector('a')!.getAttribute('href')).toBe(
      'https://acme.example/blog/best-tools',
    );
    expect(container.textContent).toContain('Before: Our tools');
    expect(container.textContent).toContain('After: The 2026 tools, compared');
    expect(container.textContent).toContain('Automatic: we fetch the page again');
  });

  it('shows a path as text, and a change that adds as Add', () => {
    render(
      <TaskDetailView
        details={parseTaskDetails({
          url: '/pricing',
          change: { before: '', after: 'A table of plans.' },
        })}
        disabled={false}
        onEdit={() => {}}
      />,
    );
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('/pricing');
    expect(container.textContent).toContain('Add: A table of plans.');
    expect(container.textContent).not.toContain('Before:');
  });

  it('shows the last automatic check, and checks now on a click (AC-010)', () => {
    const onCheck = vi.fn();
    render(
      <TaskDetailView
        details={parseTaskDetails({
          url: '/pricing',
          check: 'auto',
          autoCheck: {
            at: '2026-10-22T03:00:00Z',
            passed: false,
            missing: ['crawlers_blocked', 'noindex'],
          },
        })}
        disabled={false}
        onEdit={() => {}}
        check={{ onCheck, busy: false }}
      />,
    );
    expect(container.textContent).toContain(
      'Checked Oct 22 · robots.txt blocks AI crawlers, the page asks not to be indexed',
    );
    act(() => button('Check now').click());
    expect(onCheck).toHaveBeenCalled();
  });

  it('says a passed check, and offers no Check now for a task checked otherwise', () => {
    render(
      <TaskDetailView
        details={parseTaskDetails({
          check: 'rerun',
          autoCheck: { at: '2026-10-22T03:00:00Z', passed: true, missing: [] },
        })}
        disabled={false}
        onEdit={() => {}}
        check={{ onCheck: () => {}, busy: false }}
      />,
    );
    expect(container.textContent).toContain('Checked Oct 22 · passed');
    expect(button('Check now')).toBeUndefined();
  });

  it('asks for details when a task has none, and opens the editor', () => {
    const onEdit = vi.fn();
    render(<TaskDetailView details={null} disabled={false} onEdit={onEdit} />);
    expect(container.textContent).toContain('No details yet');
    act(() => button('Edit').click());
    expect(onEdit).toHaveBeenCalled();
  });

  it("keeps an Improve task's body and evidence", () => {
    render(
      <TaskDetailView
        details={parseTaskDetails({
          body: 'Lead with the table.',
          platformLabel: 'ChatGPT',
          sources: [{ type: 'answer', ref: '9c1e' }],
        })}
        disabled={false}
        onEdit={() => {}}
      />,
    );
    expect(container.textContent).toContain('Lead with the table.');
    expect(container.textContent).toContain('AI answer');
    expect(container.textContent).not.toContain('No details yet');
  });
});

describe('TaskDetailView without a body', () => {
  it("shows an Improve task's evidence without asking for details", () => {
    render(
      <TaskDetailView
        details={parseTaskDetails({
          platformLabel: 'Gemini',
          sources: [{ type: 'domain', ref: 'g2.com' }],
        })}
        disabled={false}
        onEdit={() => {}}
      />,
    );
    expect(container.textContent).toContain('g2.com');
    expect(container.textContent).not.toContain('No details yet');
  });
});

describe('TaskDetailForm', () => {
  it('saves every field, one step per line, and leaves an unchanged text alone', () => {
    const onSave = vi.fn();
    render(
      <TaskDetailForm
        text="Refresh /pricing"
        details={details}
        disabled={false}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    type(field('How'), 'Add a table.\n\nUpdate the title.');
    type(field('Role'), 'Editor');
    act(() => button('Save').click());
    expect(onSave).toHaveBeenCalledWith({
      title: null,
      url: '',
      where: 'acme.example/blog/best-tools · 3 prompts on ChatGPT',
      why: 'Cited #2 until Oct 8.',
      before: '',
      after: '',
      how: ['Add a table.', '', 'Update the title.'],
      doneWhen: 'Cited again on 2 of 3 platforms within 14 days.',
      check: null,
      type: 'content',
      effort: '~2h',
      role: 'Editor',
    });
  });

  it('edits the exact page and the change, and keeps how it is checked (AC-010)', () => {
    const onSave = vi.fn();
    render(
      <TaskDetailForm
        text="Refresh /pricing"
        details={parseTaskDetails({
          url: '/pricing',
          change: { before: 'Old intro', after: 'New intro' },
          check: 'rerun',
        })}
        disabled={false}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    expect(field('URL').value).toBe('/pricing');
    expect(field('Change · Before').value).toBe('Old intro');
    type(field('URL'), '/pricing/plans');
    type(field('Change · After'), 'A table of plans.');
    act(() => button('Save').click());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/pricing/plans',
        before: 'Old intro',
        after: 'A table of plans.',
        check: 'rerun',
      }),
    );
  });

  it('saves a new text, and refuses an empty one', () => {
    const onSave = vi.fn();
    render(
      <TaskDetailForm
        text="Refresh /pricing"
        details={null}
        disabled={false}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    type(field('What'), '   ');
    expect(button('Save').disabled).toBe(true);
    type(field('What'), 'Add a 2026 table to /pricing');
    act(() => button('Save').click());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Add a 2026 table to /pricing', type: null }),
    );
  });
});

describe('TaskTypeBadge', () => {
  it('names the type, and shows nothing without one', () => {
    render(<TaskTypeBadge type="on_page" />);
    expect(container.textContent).toBe('On-page');
    render(<TaskTypeBadge type={null} />);
    expect(container.textContent).toBe('');
  });
});

describe('sending a task (AC-004)', () => {
  const send = (over = {}) => ({ content: true, webhook: true, onSend: vi.fn(), ...over });

  it('offers Content for a content task and the webhook when the brand has one', () => {
    const options = send();
    render(<TaskDetailView details={details} disabled={false} onEdit={() => {}} send={options} />);
    act(() => button('Send to Content').click());
    act(() => button('Send to webhook').click());
    expect(options.onSend.mock.calls).toEqual([['content'], ['webhook']]);
  });

  it('shows where it went, and links to the opportunity instead of sending again', () => {
    render(
      <TaskDetailView
        details={parseTaskDetails({
          where: '/pricing',
          type: 'content',
          sent: {
            content: { opportunityId: 'o1', at: '2026-10-16T10:00:00Z' },
            webhook: { at: '2026-10-16T11:00:00Z' },
          },
        })}
        disabled={false}
        onEdit={() => {}}
        send={send()}
      />,
    );
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/dashboard/content?opportunity=o1',
    );
    expect(container.textContent).toContain('Sent to the webhook on Oct 16');
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Edit',
      'Send to webhook again',
    ]);
  });

  it('writes a writing task in the Content Editor, not through Send to Content', () => {
    render(
      <TaskDetailView
        details={details}
        disabled={false}
        onEdit={() => {}}
        send={send()}
        draftWork={{ method: 'create', pages: [], drafts: [], onStart: vi.fn() }}
      />,
    );
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Create content',
      'Edit',
      'Send to webhook',
    ]);
  });

  it('offers nothing it cannot do', () => {
    render(
      <TaskDetailView
        details={details}
        disabled={false}
        onEdit={() => {}}
        send={send({ content: false, webhook: false })}
      />,
    );
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Edit']);
  });
});

/** What Analyze competitor content found (learning C1), shown on the task. */
describe('TaskDetailView with competitor findings', () => {
  const findings = {
    competitorPages: [
      {
        url: 'https://rival.com/kettles/',
        domain: 'rival.com',
        cited: 4,
        words: 1200,
        passes: ['faq-schema'],
      },
      {
        url: 'https://blog.example/best',
        domain: 'blog.example',
        cited: 1,
        words: null,
        passes: [],
      },
    ],
    yourPage: {
      url: 'https://acme.com/kettles',
      domain: 'acme.com',
      cited: 1,
      words: 1,
      passes: [],
    },
    yourPageStatus: 'read' as const,
    gaps: [{ key: 'faq-schema', label: 'FAQ schema', competitors: 2, of: 2 }],
    compared: true,
    unreadable: 0,
    reason: null,
  };

  it('says which checks their pages pass and yours does not, and the pages read', () => {
    render(
      <TaskDetailView details={null} disabled={false} onEdit={() => {}} competitor={findings} />,
    );
    const text = container.textContent!;
    expect(text).toContain('What the pages AI cites instead of yours have');
    expect(text).toContain('FAQ schema — on 2 of 2 of their pages, not on yours');
    expect(text).toContain('The 2 pages read');
    expect(text).toContain('rival.com/kettles1,200 words · cited in 4 answers');
    expect(text).toContain('acme.com/kettles1 word · cited in 1 answer');
    expect(text).not.toContain('tomorrow');
    expect(container.querySelector('a[href="https://rival.com/kettles/"]')).not.toBeNull();
  });

  it('says why nothing was compared', () => {
    render(
      <TaskDetailView
        details={null}
        disabled={false}
        onEdit={() => {}}
        competitor={{ ...findings, competitorPages: [], gaps: [], reason: 'none_cited' }}
      />,
    );
    expect(container.textContent).toContain(
      "In the last two weeks, AI answers for these prompts cited no competitor page, and no page in answers that don't name your brand.",
    );
  });

  it('says when one page of theirs is too few to compare', () => {
    render(
      <TaskDetailView
        details={null}
        disabled={false}
        onEdit={() => {}}
        competitor={{
          ...findings,
          competitorPages: findings.competitorPages.slice(0, 1),
          gaps: [],
          compared: false,
        }}
      />,
    );
    expect(container.textContent).toContain(
      "Only one of their pages was read: it takes at least two to say what theirs have that yours doesn't.",
    );
    expect(container.textContent).not.toContain('Your page passes');
  });

  it("says the brand's page couldn't be read rather than that it wasn't cited", () => {
    render(
      <TaskDetailView
        details={null}
        disabled={false}
        onEdit={() => {}}
        competitor={{ ...findings, yourPage: null, yourPageStatus: 'unreadable', unreadable: 1 }}
      />,
    );
    const text = container.textContent!;
    expect(text).toContain(
      "Your page cited for these prompts couldn't be read: it may block readers.",
    );
    expect(text).not.toContain('None of your pages was cited');
    expect(text).toContain('FAQ schema — on 2 of 2 of their pages');
  });
});

/** What Find what sets your winning pages apart found (learning C4), shown on the task. */
describe('TaskDetailView with winning-page findings', () => {
  const findings = {
    winningPages: [
      {
        url: 'https://acme.com/kettles/',
        source: 'audit' as const,
        words: null,
        passes: ['tables'],
      },
      { url: 'https://acme.com/guide', source: 'read' as const, words: 1400, passes: [] },
    ],
    others: 12,
    patterns: [
      { key: 'faq-schema', label: 'FAQ schema', winners: 2, ofWinners: 2, others: 1, ofOthers: 12 },
      { key: 'tables', label: 'Tables', winners: 1, ofWinners: 2, others: 0, ofOthers: 12 },
    ],
    missingPages: [{ url: 'https://acme.com/tea', missing: ['faq-schema', 'tables'] }],
    unreadable: 0,
    reason: null,
  };

  it('says which checks set the winning pages apart, and the pages that miss them', () => {
    render(<TaskDetailView details={null} disabled={false} onEdit={() => {}} winning={findings} />);
    const text = container.textContent!;
    expect(text).toContain('What sets your winning pages apart');
    expect(text).toContain('FAQ schema — winning pages 2 of 2, your other pages 1 of 12');
    expect(text).toContain('Your 2 winning pages');
    expect(text).toContain('acme.com/kettlesfrom its Site Audit');
    expect(text).toContain('acme.com/guideread for this task · 1,400 words');
    expect(text).toContain('acme.com/teamissing FAQ schema, Tables');
    expect(text).toContain(
      'Compared with 12 other pages of yours that Site Audit checked in the last 90 days.',
    );
    expect(container.querySelector('a[href="https://acme.com/tea"]')).not.toBeNull();
  });

  it('says when nothing sets them apart, and why nothing was compared', () => {
    render(
      <TaskDetailView
        details={null}
        disabled={false}
        onEdit={() => {}}
        winning={{ ...findings, patterns: [], missingPages: [] }}
      />,
    );
    expect(container.textContent).toContain(
      'Your other audited pages pass the same Site Audit checks your winning pages pass',
    );
    render(
      <TaskDetailView
        details={null}
        disabled={false}
        onEdit={() => {}}
        winning={{
          ...findings,
          winningPages: [],
          patterns: [],
          missingPages: [],
          others: 2,
          reason: 'too_few_audited',
        }}
      />,
    );
    expect(container.textContent).toContain(
      'Fewer than three of your other pages have a Site Audit from the last 90 days.',
    );
    expect(container.textContent).not.toContain('Compared with');
  });
});

/** What Chat attached to a task (CHAT-09 items 13, 16; the owner's decision of 2026-10-31). */
describe('TaskDetailView with files attached from Chat', () => {
  const attachments = [
    {
      fileId: 'f1',
      title: 'Pricing FAQ',
      type: 'document' as const,
      attachedAt: '2026-10-30T09:00:00Z',
      attachedBy: 'Alex Morgan',
      href: '/dashboard/content/editor/d1',
      draft: true,
    },
    {
      fileId: 'f2',
      title: 'FAQPage schema',
      type: 'code' as const,
      attachedAt: '2026-10-31T09:00:00Z',
      attachedBy: null,
      href: '/api/chat/files/f2',
      draft: false,
    },
  ];

  it('lists each with who attached it, when, and where it opens', () => {
    render(
      <TaskDetailView
        details={null}
        disabled={false}
        onEdit={() => {}}
        attachments={attachments}
      />,
    );
    const list = container.querySelector('section[aria-label="Attached from Chat"]')!;
    expect(list.textContent).toContain('Attached from Chat');
    const rows = [...list.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toEqual([
      'Pricing FAQAlex Morgan · Oct 30Open draft',
      'FAQPage schemaA teammate · Oct 31Open',
    ]);
    expect([...list.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/dashboard/content/editor/d1',
      '/api/chat/files/f2',
    ]);
  });

  it('shows nothing when Chat attached nothing', () => {
    render(<TaskDetailView details={null} disabled={false} onEdit={() => {}} />);
    expect(container.textContent).not.toContain('Attached from Chat');
  });
});
