'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useEditorState, type Editor } from '@tiptap/react';
import { FloatingMenu } from '@tiptap/react/menus';
import type { EditorState } from '@tiptap/pm/state';
import {
  Bold,
  Code2,
  ExternalLink,
  Columns3,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Paperclip,
  Quote,
  Rows3,
  ShoppingBag,
  Table2,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { ImageUploadButton } from '@/components/content/ImageUploadButton';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatNumber } from '@/lib/format';
import { safeImageSrc, safeLinkHref } from '@/lib/content/editor';
import { cn } from '@/lib/utils';
import { HtmlBlockDialog } from './_HtmlBlock';
import { ProductBlockDialog } from './_ProductBlockDialog';
import { h1Positions } from './_oneH1';
import { PlaceholderNav } from './_PlaceholderNav';

/**
 * Where the insert menu shows: the cursor on an empty paragraph between the
 * page's blocks, in a page with something on it (an empty page shows its
 * placeholder there instead).
 */
export function onEmptyLine(editor: Editor, state: EditorState): boolean {
  const { $anchor, empty } = state.selection;
  return (
    empty &&
    !editor.isEmpty &&
    $anchor.depth === 1 &&
    $anchor.parent.type.name === 'paragraph' &&
    $anchor.parent.childCount === 0
  );
}

/**
 * The editor's toolbar (CE-004, spec §6): H1 H2 H3 · B I link · lists,
 * quote · table, image, Add HTML, attach a file · </> HTML, the placeholders left to fill
 * (PlaceholderNav) and the length counter against the page type's target. Inside a table it adds a row, a column, or removes the
 * table. While the HTML view is open, only its own button works. On an empty
 * line, a small menu offers an HTML block, a table or an image there. With
 * `productsBrandId` (an online shop's draft), both offer products from its
 * catalog too (shopping path, part 5).
 */
export function EditorToolbar({
  editor,
  target,
  lengthWarning,
  htmlView,
  onToggleHtml,
  onAttach,
  linkRequest = 0,
  placeholders,
  productsBrandId = null,
}: {
  editor: Editor;
  target: number;
  /** The Length rule is on and reads short or long (lengthWarns): amber. */
  lengthWarning: boolean;
  htmlView: boolean;
  onToggleHtml: () => void;
  onAttach: () => void;
  /**
   * A new number opens the link dialog on the selection: Quality's Add
   * source, its claim selected (CE-045).
   */
  linkRequest?: number;
  /** The placeholders a send or an export finds outside the page's text, and how to show them. */
  placeholders?: { hidden: number; onShowHidden: () => void };
  /** The brand whose catalog + Insert › Products picks from; null hides it. */
  productsBrandId?: string | null;
}) {
  const t = useTranslations('contentEditor.editor.toolbar');
  // A read-only workspace (plan not active): each tool that changes the page
  // opens the upgrade dialog instead; </> HTML still shows the source.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const edit = (run: () => void) => guard(run, { action: tActions('editContent') });
  const [dialog, setDialog] = useState<'link' | 'image' | 'htmlBlock' | 'products' | null>(null);
  // Only a new request opens it: not the toolbar showing again.
  const [linkAsked, setLinkAsked] = useState(linkRequest);
  if (linkRequest !== linkAsked) {
    setLinkAsked(linkRequest);
    if (linkRequest > 0) setDialog('link');
  }

  // Re-read only what the toolbar shows, not on every keystroke's render.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e.isActive('heading', { level: 1 }),
      // A page has one H1: another can't be made while it has one.
      h1Taken: !e.isActive('heading', { level: 1 }) && h1Positions(e.state.doc).length > 0,
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      link: e.isActive('link'),
      href: e.isActive('link')
        ? ((e.getAttributes('link').href as string | undefined) ?? null)
        : null,
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      blockquote: e.isActive('blockquote'),
      inTable: e.isActive('table'),
      characters: e.storage.characterCount.characters() as number,
      words: e.storage.characterCount.words() as number,
    }),
  });

  const chain = () => editor.chain().focus();
  /** Why a tool can't be used now, by its key. */
  const off: Record<string, string | undefined> = {
    h1: state.h1Taken ? t('h1Taken') : undefined,
  };
  const insertTable = () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  const tools: { key: string; icon: LucideIcon; on: boolean; run: () => void; text?: string }[][] =
    [
      [
        {
          key: 'h1',
          icon: Heading1,
          on: state.h1,
          run: () => chain().toggleHeading({ level: 1 }).run(),
        },
        {
          key: 'h2',
          icon: Heading2,
          on: state.h2,
          run: () => chain().toggleHeading({ level: 2 }).run(),
        },
        {
          key: 'h3',
          icon: Heading3,
          on: state.h3,
          run: () => chain().toggleHeading({ level: 3 }).run(),
        },
      ],
      [
        { key: 'bold', icon: Bold, on: state.bold, run: () => chain().toggleBold().run() },
        { key: 'italic', icon: Italic, on: state.italic, run: () => chain().toggleItalic().run() },
        { key: 'link', icon: Link2, on: state.link, run: () => setDialog('link') },
      ],
      [
        {
          key: 'bulletList',
          icon: List,
          on: state.bulletList,
          run: () => chain().toggleBulletList().run(),
        },
        {
          key: 'orderedList',
          icon: ListOrdered,
          on: state.orderedList,
          run: () => chain().toggleOrderedList().run(),
        },
        {
          key: 'quote',
          icon: Quote,
          on: state.blockquote,
          run: () => chain().toggleBlockquote().run(),
        },
      ],
      [
        {
          key: 'table',
          icon: Table2,
          on: state.inTable,
          run: insertTable,
        },
        { key: 'image', icon: ImagePlus, on: false, run: () => setDialog('image') },
        // Named, not only an icon: the way to put any HTML in the page.
        {
          key: 'htmlBlock',
          icon: Code2,
          on: false,
          run: () => setDialog('htmlBlock'),
          text: t('addHtml'),
        },
        ...(productsBrandId
          ? [
              {
                key: 'products',
                icon: ShoppingBag,
                on: false,
                run: () => setDialog('products'),
              },
            ]
          : []),
        { key: 'attach', icon: Paperclip, on: false, run: onAttach },
      ],
    ];
  const tableTools = [
    { key: 'addRow', icon: Rows3, run: () => chain().addRowAfter().run() },
    { key: 'addColumn', icon: Columns3, run: () => chain().addColumnAfter().run() },
    { key: 'deleteTable', icon: Trash2, run: () => chain().deleteTable().run() },
  ];

  return (
    <div
      role="toolbar"
      aria-label={t('label')}
      className="flex flex-wrap items-center gap-0.5 border-b px-4 py-1.5"
    >
      {tools.map((group, i) => (
        <div key={i} className="flex items-center gap-0.5">
          {i > 0 && <span aria-hidden="true" className="mx-1.5 h-5 w-px bg-border" />}
          {group.map((tool) => (
            <ToolButton
              key={tool.key}
              label={off[tool.key] ?? t(tool.key)}
              pressed={!htmlView && tool.on}
              disabled={htmlView}
              blocked={!!off[tool.key]}
              onClick={edit(tool.run)}
            >
              <tool.icon className="h-4 w-4" />
              {tool.text && <span className="ml-1 text-xs font-medium">{tool.text}</span>}
            </ToolButton>
          ))}
        </div>
      ))}
      <span aria-hidden="true" className="mx-1.5 h-5 w-px bg-border" />
      <ToolButton
        label={htmlView ? t('htmlBack') : t('html')}
        pressed={htmlView}
        onClick={onToggleHtml}
      >
        <span className="font-mono text-[11.5px] font-medium">&lt;/&gt; HTML</span>
      </ToolButton>
      {state.href && !htmlView && <LinkTarget href={state.href} />}
      {state.inTable && !htmlView && (
        <div className="flex items-center gap-0.5">
          <span aria-hidden="true" className="mx-1.5 h-5 w-px bg-border" />
          {tableTools.map((tool) => (
            <ToolButton key={tool.key} label={t(tool.key)} onClick={edit(tool.run)}>
              <tool.icon className="h-4 w-4" />
            </ToolButton>
          ))}
        </div>
      )}
      <div className="ml-auto flex items-center gap-3">
        {placeholders && !htmlView && (
          <PlaceholderNav
            editor={editor}
            hidden={placeholders.hidden}
            onShowHidden={placeholders.onShowHidden}
          />
        )}
        <span
          className={cn(
            'text-xs font-medium tabular-nums text-muted-foreground',
            lengthWarning && 'text-amber-700 dark:text-amber-400',
          )}
        >
          {t('counter', {
            count: formatNumber(state.characters),
            target: formatNumber(target),
            words: state.words,
          })}
        </span>
      </div>

      {/* On an empty line, what can go there, as Webflow offers between
          blocks; not on an empty page, which shows its placeholder. */}
      <FloatingMenu
        editor={editor}
        shouldShow={({ editor: e, state: s }) =>
          e.isEditable && e.view.hasFocus() && onEmptyLine(e, s)
        }
        className="flex items-center gap-0.5 rounded-md border bg-popover p-0.5 shadow-sm"
      >
        <span className="px-1.5 text-xs text-muted-foreground">{t('insert.label')}</span>
        {(
          [
            { key: 'html', icon: Code2, run: () => setDialog('htmlBlock') },
            { key: 'table', icon: Table2, run: insertTable },
            { key: 'image', icon: ImagePlus, run: () => setDialog('image') },
            ...(productsBrandId
              ? [{ key: 'products', icon: ShoppingBag, run: () => setDialog('products') }]
              : []),
          ] as const
        ).map((item) => (
          <ToolButton key={item.key} label={t(`insert.${item.key}Hint`)} onClick={item.run}>
            <item.icon className="h-3.5 w-3.5" />
            <span className="ml-1 text-xs font-medium">{t(`insert.${item.key}`)}</span>
          </ToolButton>
        ))}
      </FloatingMenu>

      {/* Mounted while open, so each opening starts from the selection. */}
      {dialog === 'link' && <LinkDialog editor={editor} onClose={() => setDialog(null)} />}
      {dialog === 'image' && <ImageDialog editor={editor} onClose={() => setDialog(null)} />}
      {dialog === 'products' && productsBrandId && (
        <ProductBlockDialog
          brandId={productsBrandId}
          onInsert={(code) =>
            editor.chain().focus().insertContent({ type: 'htmlBlock', attrs: { code } }).run()
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'htmlBlock' && (
        <HtmlBlockDialog
          initial=""
          onSave={(code) =>
            editor.chain().focus().insertContent({ type: 'htmlBlock', attrs: { code } }).run()
          }
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

/**
 * The link the cursor is in: its address, and a way to open it in a new tab
 * (a path on the brand's own site has no address here to open).
 */
function LinkTarget({ href }: { href: string }) {
  const t = useTranslations('contentEditor.editor.toolbar');
  const safe = safeLinkHref(href);
  const label = href.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const className =
    'ml-1 flex max-w-[240px] items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-blue-600 dark:text-blue-400';
  if (!safe || !/^https?:/.test(safe)) {
    return (
      <span className={cn(className, 'text-muted-foreground dark:text-muted-foreground')}>
        <span className="truncate">{label}</span>
      </span>
    );
  }
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      title={t('openLink')}
      className={cn(className, 'hover:bg-muted hover:underline')}
    >
      <span className="truncate">{label}</span>
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

function ToolButton({
  label,
  pressed,
  disabled,
  blocked,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  /** Can't be used here, but still says why on hover (a disabled button can't). */
  blocked?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      aria-disabled={blocked || undefined}
      disabled={disabled}
      // Keep the editor's selection: a click on the toolbar mustn't move focus first.
      onMouseDown={(e) => e.preventDefault()}
      onClick={blocked ? undefined : onClick}
      className={cn(
        'flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40',
        pressed && 'bg-muted text-foreground',
        blocked && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** Set, change or remove the link on the selection. */
function LinkDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const t = useTranslations('contentEditor.editor.link');
  const [current] = useState(() => editor.getAttributes('link').href as string | undefined);
  const [value, setValue] = useState(current ?? '');
  const [invalid, setInvalid] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);

  const apply = () => {
    const href = safeLinkHref(value);
    if (!href) {
      setInvalid(true);
      return;
    }
    if (editor.state.selection.empty && !current) {
      // Nothing selected: the address goes in as its own link text.
      editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
        .run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md" initialFocus={fieldRef}>
        <DialogHeader>
          <DialogTitle>{current ? t('editTitle') : t('title')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <Label htmlFor="content-link-href">{t('label')}</Label>
          <Input
            id="content-link-href"
            ref={fieldRef}
            value={value}
            placeholder={t('placeholder')}
            aria-invalid={invalid}
            onChange={(e) => {
              setValue(e.target.value);
              setInvalid(false);
            }}
          />
          {invalid && <p className="text-xs text-destructive">{t('invalid')}</p>}
        </form>
        <DialogFooter>
          {current && (
            <Button
              variant="ghost"
              className="mr-auto text-muted-foreground"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
                onClose();
              }}
            >
              {t('remove')}
            </Button>
          )}
          <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
          <Button onClick={apply}>{t('apply')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Insert an image by its address, or uploaded from the person's computer (00272). */
function ImageDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const t = useTranslations('contentEditor.editor.image');
  const tUpload = useTranslations('content.imageUpload');
  const [src, setSrc] = useState('');
  const [alt, setAlt] = useState('');
  const [invalid, setInvalid] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);

  const insert = () => {
    const safe = safeImageSrc(src);
    if (!safe) {
      setInvalid(true);
      return;
    }
    editor
      .chain()
      .focus()
      .setImage({ src: safe, alt: alt.trim() || undefined })
      .run();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md" initialFocus={fieldRef}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            insert();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="content-image-src">{t('srcLabel')}</Label>
            <Input
              id="content-image-src"
              ref={fieldRef}
              value={src}
              placeholder="https://"
              aria-invalid={invalid}
              onChange={(e) => {
                setSrc(e.target.value);
                setInvalid(false);
              }}
            />
            {invalid && <p className="text-xs text-destructive">{t('invalid')}</p>}
            {/* Or from their computer (00272): its address fills the field. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <ImageUploadButton
                className="h-7"
                onUploaded={(url) => {
                  setSrc(url);
                  setInvalid(false);
                }}
              />
              <span className="text-xs text-muted-foreground">{tUpload('hint')}</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="content-image-alt">{t('altLabel')}</Label>
            <Input
              id="content-image-alt"
              value={alt}
              placeholder={t('altPlaceholder')}
              onChange={(e) => setAlt(e.target.value)}
            />
          </div>
          {/* Enter in either field inserts. */}
          <button type="submit" hidden />
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
          <Button onClick={insert}>{t('insert')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
