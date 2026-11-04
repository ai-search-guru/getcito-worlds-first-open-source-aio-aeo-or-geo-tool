'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import type { AgentChartSpec } from '@/components/agent/AgentChart';
import { AuditResultCard } from '@/components/audit/AuditResultCard';
import type { AgentAuditSpec } from '@/components/agent/AgentChart';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
const AgentChart = dynamic(
  () => import('@/components/agent/AgentChart').then((m) => m.AgentChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-64 w-full" />,
  },
);
import { useFeatureGate } from '@/hooks/useFeatureGate';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { isSubscriptionInactive } from '@/lib/apiFailure';
import { takeBackUnansweredTurn } from '@/lib/agent/unansweredTurn';
import { Link } from '@/i18n/navigation';
import { Button, buttonVariants } from '@/components/ui/button';
import { Markdown } from '@/components/ui/markdown';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/state/useBrandStore';
import { toast } from 'sonner';
import {
  Check,
  Copy,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Loader2,
  Crown,
  Wrench,
  ChevronDown,
  KeyRound,
} from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ConversationRow {
  id: string;
  title: string;
  brand_id: string | null;
  created_at: string;
  updated_at: string;
}

interface AgentMessageRow {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls: UIMessage['parts'] | null;
  created_at: string;
}

export default function AgentPage() {
  const { canUse, requiredPlanFor, isCloud } = useFeatureGate();
  const allowed = canUse('ai_agent');

  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [hydrating, setHydrating] = useState(true);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Plan gate — `ai_agent` is in every cloud plan post-BYOK, so this only
  // bites if the org's plan was somehow stripped of the feature. Kept as
  // a defensive check.
  if (!allowed) {
    return <PlanGate requiredPlan={requiredPlanFor('ai_agent')} />;
  }

  // BYOK gate — on cloud the real gate is "has the org saved a provider key
  // for Chat?". We probe the same endpoint Settings › AI Providers uses; if it's not
  // configured, send the user to Settings instead of letting them type a
  // message that would 403 on submit. Self-host bypasses (key is in env).
  if (isCloud) {
    return (
      <KeyGatedAgentChat
        conversations={conversations}
        setConversations={setConversations}
        activeId={activeId}
        setActiveId={setActiveId}
        initialMessages={initialMessages}
        setInitialMessages={setInitialMessages}
        hydrating={hydrating}
        setHydrating={setHydrating}
        input={input}
        setInput={setInput}
        messagesEndRef={messagesEndRef}
      />
    );
  }

  return (
    <AgentChat
      conversations={conversations}
      setConversations={setConversations}
      activeId={activeId}
      setActiveId={setActiveId}
      initialMessages={initialMessages}
      setInitialMessages={setInitialMessages}
      hydrating={hydrating}
      setHydrating={setHydrating}
      input={input}
      setInput={setInput}
      messagesEndRef={messagesEndRef}
    />
  );
}

function AgentChat(props: {
  conversations: ConversationRow[];
  setConversations: React.Dispatch<React.SetStateAction<ConversationRow[]>>;
  activeId: string | null;
  setActiveId: React.Dispatch<React.SetStateAction<string | null>>;
  initialMessages: UIMessage[];
  setInitialMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>;
  hydrating: boolean;
  setHydrating: React.Dispatch<React.SetStateAction<boolean>>;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  messagesEndRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const {
    conversations,
    setConversations,
    activeId,
    setActiveId,
    initialMessages,
    setInitialMessages,
    hydrating,
    setHydrating,
    input,
    setInput,
    messagesEndRef,
  } = props;
  const t = useTranslations('agent');
  const tc = useTranslations('common');
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);
  // A chat turn is an action: a read-only workspace gets the upgrade dialog.
  const { isLocked, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  // Ref mirrors activeId for prepareSendMessagesRequest. Reading the
  // state directly from the transport closure gives us a stale snapshot —
  // setActiveId is async, so a "+ new chat then immediately send" flow
  // would post conversationId: null and the server replies 400. The ref
  // updates synchronously when we change the active conversation.
  const activeIdRef = useRef<string | null>(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const { messages, sendMessage, status, setMessages, stop, error, clearError } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/agent/chat',
      // Always forward the active conversation id alongside the messages
      // array — the server saves messages keyed off it. Caller can also
      // pass body via sendMessage(message, { body }) to override the id
      // synchronously (first-message-of-new-chat path uses this).
      prepareSendMessagesRequest: ({ messages, body }) => ({
        body: {
          conversationId: activeIdRef.current,
          ...(body ?? {}),
          messages,
        },
      }),
    }),
  });

  // The server's subscription_inactive (the plan lapsed while the page was
  // open): the upgrade dialog, the person's message back in the input rather
  // than left unanswered in the thread, and the chat ready for the next try.
  useEffect(() => {
    if (error && isSubscriptionInactive(error.message)) {
      const back = takeBackUnansweredTurn(messages);
      if (back) {
        setMessages(back.messages);
        setInput(back.text);
      }
      openUpgrade();
      clearError();
    }
  }, [error, messages, setMessages, setInput, openUpgrade, clearError]);

  // Sync hydrated messages into the chat hook whenever we switch conversation.
  useEffect(() => {
    setMessages(initialMessages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessages]);

  // Auto-scroll on new messages / streaming chunks.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, messagesEndRef]);

  // Initial load of the conversation list + the most-recent conversation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/agent/conversations');
        if (!res.ok) {
          setHydrating(false);
          return;
        }
        const { conversations: list } = (await res.json()) as {
          conversations: ConversationRow[];
        };
        if (cancelled) return;
        setConversations(list);
        if (list.length > 0) {
          await loadConversation(list[0]!.id);
        } else {
          setHydrating(false);
        }
      } catch {
        setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadConversation(id: string) {
    setHydrating(true);
    setActiveId(id);
    try {
      const res = await fetch(`/api/agent/conversations/${id}`);
      if (!res.ok) {
        setInitialMessages([]);
        return;
      }
      const { messages: rows } = (await res.json()) as {
        messages: AgentMessageRow[];
      };
      // Rehydrate UIMessages. We saved `tool_calls` as the full parts
      // array, so prefer it; fall back to a single text part from the
      // `content` column.
      const hydrated: UIMessage[] = rows.map((r) => ({
        id: r.id,
        role: r.role === 'tool' ? 'assistant' : r.role,
        parts:
          Array.isArray(r.tool_calls) && r.tool_calls.length > 0
            ? (r.tool_calls as UIMessage['parts'])
            : [{ type: 'text', text: r.content }],
      })) as UIMessage[];
      setInitialMessages(hydrated);
    } finally {
      setHydrating(false);
    }
  }

  async function newChat() {
    if (isLocked) {
      openUpgrade(tActions('startChat'));
      return;
    }
    const res = await fetch('/api/agent/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandId: activeBrandId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (isSubscriptionInactive(body)) {
        openUpgrade();
        return;
      }

      toast.error(body?.error ?? 'Failed to create chat');
      return;
    }
    const { conversation } = (await res.json()) as { conversation: ConversationRow };
    setConversations((prev) => [conversation, ...prev]);
    setActiveId(conversation.id);
    setInitialMessages([]);
    setInput('');
  }

  async function deleteConversation(id: string) {
    const res = await fetch(`/api/agent/conversations/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => null);

      toast.error(body?.error ?? 'Failed to delete conversation');
      return;
    }
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      setActiveId(null);
      setInitialMessages([]);
      setMessages([]);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || status !== 'ready') return;
    if (isLocked) {
      openUpgrade(tActions('sendChat'));
      return;
    }

    // Resolve the conversation id we'll send with this message. If no chat
    // is selected, spin one up. Captured into a local so the sendMessage
    // call below uses today's value (the ref + state update happen, but
    // sendMessage's body argument is what the server actually reads).
    let convId = activeId;
    if (!convId) {
      const res = await fetch('/api/agent/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId: activeBrandId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (isSubscriptionInactive(body)) {
          openUpgrade();
          return;
        }

        toast.error(body?.error ?? 'Failed to create conversation');
        return;
      }
      const { conversation } = (await res.json()) as { conversation: ConversationRow };
      setConversations((prev) => [conversation, ...prev]);
      setActiveId(conversation.id);
      activeIdRef.current = conversation.id;
      convId = conversation.id;
    }
    // Emptied as it goes out: a refused turn (a read-only workspace) puts
    // the text back, and so does a send that throws.
    setInput('');
    try {
      await sendMessage({ text }, { body: { conversationId: convId } });
    } catch {
      setInput(text);
      toast.error('Failed to send message');
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] md:h-screen -m-6">
      <aside className="w-72 border-r bg-card flex flex-col">
        <div className="p-3 border-b">
          <Button onClick={newChat} variant="outline" className="w-full justify-start gap-2">
            <Plus className="h-4 w-4" />
            {t('newChat')}
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">{t('noConversations')}</p>
          )}
          {conversations.map((c) => (
            // Outer wrapper is a div with role="button" rather than a real
            // <button> because we render the delete control as a nested
            // <button> inside it — HTML doesn't allow button-in-button
            // (hydration error in Next.js). Keyboard support via tabIndex +
            // onKeyDown preserves the same affordance.
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => loadConversation(c.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  loadConversation(c.id);
                }
              }}
              className={cn(
                'w-full text-left text-sm rounded-md px-3 py-2 flex items-start gap-2 group hover:bg-accent transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                activeId === c.id && 'bg-accent',
              )}
            >
              <span className="flex-1 truncate">{c.title}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  // Open in read-only too: deleting a conversation costs nothing
                  // and the API (#1613) and the FAQ keep it open.
                  setPendingConfirm(c.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                aria-label={t('deleteConversation')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <Dialog
            open={pendingConfirm !== null}
            onOpenChange={(v) => !v && setPendingConfirm(null)}
          >
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>{t('deleteConversation')}</DialogTitle>
                <DialogDescription>{t('deleteConfirm')}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>{tc('cancel')}</DialogClose>
                <DialogClose
                  render={
                    <Button
                      variant="destructive"
                      onClick={(e) => {
                        e.stopPropagation();

                        if (pendingConfirm === null) {
                          return;
                        }
                        void deleteConversation(pendingConfirm);
                      }}
                    />
                  }
                >
                  {tc('delete')}
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {hydrating ? (
            <div className="flex items-center justify-center h-full text-muted-foreground gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('loadingConversation')}
            </div>
          ) : messages.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="max-w-3xl mx-auto space-y-6">
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
              {(status === 'submitted' || status === 'streaming') && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('thinking')}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} className="border-t bg-background px-6 py-4">
          <div className="max-w-3xl mx-auto flex gap-2 items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void onSubmit(e as unknown as React.FormEvent);
                }
              }}
              placeholder={t('inputPlaceholder')}
              rows={1}
              disabled={status !== 'ready'}
              className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:opacity-50"
            />
            {status === 'streaming' || status === 'submitted' ? (
              <Button type="button" variant="outline" onClick={() => stop()}>
                {t('stop')}
              </Button>
            ) : (
              <Button type="submit" disabled={!input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </form>
      </main>
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const t = useTranslations('agent');
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  const rawText = (message.parts ?? [])
    .filter((p) => p.type === 'text')
    .map((p) => (p as { type: 'text'; text: string }).text)
    .join('\n\n');

  async function handleCopy() {
    await navigator.clipboard.writeText(rawText).catch(() => {});
    setCopied(true);
    toast.success(t('copied'));
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={cn('group flex gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" />
        </div>
      )}
      <div
        className={cn(
          'relative max-w-[80%] rounded-2xl px-4 py-3 text-sm',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-card border',
        )}
      >
        {(message.parts ?? []).map((part, i) => {
          if (part.type === 'text') {
            // User messages stay plain — they're typed text, not authored
            // markdown, and the chat bubble background contrasts more
            // cleanly without prose styling. Assistant output is intended
            // to be markdown (lists, **bold**, headings, links), so render
            // it through the same component the rest of the dashboard uses.
            if (isUser) {
              return (
                <p key={i} className="whitespace-pre-wrap leading-relaxed">
                  {part.text}
                </p>
              );
            }
            return (
              <Markdown
                key={i}
                className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              >
                {part.text}
              </Markdown>
            );
          }
          if (part.type === 'tool-render_chart') {
            return <ChartToolPart key={i} part={part} />;
          }
          if (part.type === 'tool-render_audit') {
            return <AuditToolPart key={i} part={part} />;
          }
          if (part.type.startsWith('tool-')) {
            return <ToolCallDisclosure key={i} part={part} />;
          }
          return null;
        })}
        {!isUser && rawText && (
          <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label={copied ? t('copied') : t('copyMessage')}
            className="absolute bottom-2 right-2 p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground transition-opacity"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Disclosure-style renderer for a `tool-<name>` UIMessage part.
 *
 * AI SDK v6 tool parts carry an internal `state` machine
 * (`input-streaming` → `input-available` → `output-available` | `output-error`).
 * Surfacing the raw state string ("output-available") to end users is noise —
 * what they actually want is "what did the agent ask and what came back?".
 *
 * So the collapsed view is a clean chip: tool name + chevron, with a spinner
 * while the call is still resolving. Clicking expands an inline console-style
 * panel that shows the input args and output payload as pretty-printed JSON,
 * the same affordance most agent UIs (Claude, ChatGPT, Cursor) ship.
 */
function ToolCallDisclosure({ part }: { part: UIMessage['parts'][number] }) {
  const t = useTranslations('agent');
  const [open, setOpen] = useState(false);
  // Tool parts in AI SDK v6 carry these fields at the part level; we narrow
  // here rather than importing the union type because each tool gets a
  // distinct generated discriminant.
  const toolPart = part as unknown as {
    type: string;
    toolName?: string;
    state?: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
    input?: unknown;
    output?: unknown;
    errorText?: string;
  };
  const name = toolPart.toolName ?? part.type.replace('tool-', '');
  const isRunning = toolPart.state === 'input-streaming' || toolPart.state === 'input-available';
  const hasError = toolPart.state === 'output-error';
  const hasInput = toolPart.input !== undefined && toolPart.input !== null;
  const hasOutput = toolPart.output !== undefined && toolPart.output !== null;
  const hasDetails = hasInput || hasOutput || !!toolPart.errorText;

  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => hasDetails && setOpen((o) => !o)}
        disabled={!hasDetails}
        className={cn(
          'inline-flex items-center gap-1.5 text-xs rounded-md px-2 py-1 transition-colors',
          hasError
            ? 'bg-destructive/10 text-destructive hover:bg-destructive/15'
            : 'bg-muted text-muted-foreground hover:bg-muted/70',
          !hasDetails && 'cursor-default opacity-80',
        )}
        aria-expanded={open}
      >
        {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
        <span className="font-mono">{name}</span>
        {hasDetails && (
          <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
        )}
      </button>
      {open && hasDetails && (
        <div className="mt-2 rounded-md border bg-muted/40 p-3 text-xs space-y-3 max-w-full">
          {hasInput && (
            <div>
              <p className="text-muted-foreground font-medium mb-1 uppercase tracking-wider text-[10px]">
                {t('toolInput')}
              </p>
              <pre className="font-mono text-[11px] whitespace-pre-wrap break-words leading-relaxed text-foreground/90">
                {safeStringify(toolPart.input)}
              </pre>
            </div>
          )}
          {hasOutput && (
            <div>
              <p className="text-muted-foreground font-medium mb-1 uppercase tracking-wider text-[10px]">
                {t('toolOutput')}
              </p>
              <pre className="font-mono text-[11px] whitespace-pre-wrap break-words leading-relaxed text-foreground/90 max-h-80 overflow-y-auto">
                {safeStringify(toolPart.output)}
              </pre>
            </div>
          )}
          {toolPart.errorText && (
            <div>
              <p className="text-destructive font-medium mb-1 uppercase tracking-wider text-[10px]">
                {t('toolError')}
              </p>
              <pre className="font-mono text-[11px] whitespace-pre-wrap break-words leading-relaxed text-destructive">
                {toolPart.errorText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Renderer for the `tool-render_chart` part. Once the tool reaches the
 * `output-available` state, the input args (which the tool echoes back as
 * its output) describe a chart spec we can hand to {@link AgentChart}.
 *
 * While the call is in flight we show a tiny spinner stub — same shape as
 * the generic tool disclosure, just without the JSON expansion since
 * there's no payload to inspect on a chart call.
 */
function ChartToolPart({ part }: { part: UIMessage['parts'][number] }) {
  const toolPart = part as unknown as {
    type: string;
    state?: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
    input?: AgentChartSpec;
    output?: AgentChartSpec;
    errorText?: string;
  };

  if (toolPart.state === 'output-error') {
    return (
      <div className="my-2 rounded-md border bg-destructive/10 text-destructive px-2 py-1 text-xs">
        <span className="font-mono">render_chart</span>
        {toolPart.errorText && <span className="ml-2">{toolPart.errorText}</span>}
      </div>
    );
  }

  const spec = toolPart.output ?? toolPart.input;
  if (!spec || !Array.isArray(spec.data) || spec.data.length === 0) {
    return (
      <div className="my-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted rounded-md px-2 py-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="font-mono">render_chart</span>
      </div>
    );
  }

  return <AgentChart spec={spec} />;
}
function AuditToolPart({ part }: { part: UIMessage['parts'][number] }) {
  const toolPart = part as unknown as {
    type: string;
    state?: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
    input?: AgentAuditSpec;
    output?: AgentAuditSpec;
    errorText?: string;
  };

  if (toolPart.state === 'output-error') {
    return (
      <div className="my-2 rounded-md border bg-destructive/10 px-2 py-1 text-xs text-destructive">
        <span className="font-mono">render_audit</span>
        {toolPart.errorText && <span className="ml-2">{toolPart.errorText}</span>}
      </div>
    );
  }

  const audit = toolPart.output ?? toolPart.input;

  if (!audit) {
    return (
      <div className="my-2 inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="font-mono">render_audit</span>
      </div>
    );
  }

  return <AuditResultCard audit={audit} />;
}

function EmptyState() {
  const t = useTranslations('agent');
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center max-w-md">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-4">
          <Sparkles className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold">{t('emptyTitle')}</h2>
        <p className="text-sm text-muted-foreground mt-2">
          {t('emptyBody')} <em>{t('emptyExample1')}</em> {t('emptyBodyOr')}{' '}
          <em>{t('emptyExample2')}</em>
        </p>
      </div>
    </div>
  );
}

/**
 * Cloud wrapper: probes /api/settings/ai-providers once on mount and
 * either renders the chat (key configured) or a Settings CTA (no key).
 * Self-host renders AgentChat directly — its key check is environmental.
 */
function KeyGatedAgentChat(props: React.ComponentProps<typeof AgentChat>) {
  const [status, setStatus] = useState<'loading' | 'configured' | 'missing'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings/ai-providers');
        if (!res.ok) {
          if (!cancelled) setStatus('missing');
          return;
        }
        const body = (await res.json()) as { configured?: boolean };
        if (!cancelled) setStatus(body.configured ? 'configured' : 'missing');
      } catch {
        if (!cancelled) setStatus('missing');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'loading') {
    return (
      <div className="flex h-[calc(100vh-4rem)] md:h-screen items-center justify-center -m-6 p-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (status === 'missing') {
    return <KeyMissingState />;
  }
  return <AgentChat {...props} />;
}

function KeyMissingState() {
  const t = useTranslations('agent');
  return (
    <div className="flex h-[calc(100vh-4rem)] md:h-screen items-center justify-center -m-6 p-6">
      <div className="text-center max-w-md">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary mb-4">
          <KeyRound className="h-7 w-7" />
        </div>
        <h2 className="text-lg font-semibold">{t('keyMissingTitle')}</h2>
        <p className="text-sm text-muted-foreground mt-2">{t('keyMissingBody')}</p>
        <Link
          href="/dashboard/settings/ai-providers"
          className={cn(buttonVariants({ variant: 'default' }), 'mt-5 gap-2')}
        >
          <KeyRound className="h-4 w-4" />
          {t('goToSettings')}
        </Link>
      </div>
    </div>
  );
}

function PlanGate({ requiredPlan }: { requiredPlan: string }) {
  const t = useTranslations('agent');
  return (
    <div className="flex h-[calc(100vh-4rem)] md:h-screen items-center justify-center -m-6 p-6">
      <div className="text-center max-w-md">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 mb-4">
          <Crown className="h-7 w-7 text-amber-600 dark:text-amber-400" />
        </div>
        <h2 className="text-lg font-semibold">{t('planGateTitle', { plan: requiredPlan })}</h2>
        <p className="text-sm text-muted-foreground mt-2">{t('planGateBody')}</p>
      </div>
    </div>
  );
}
