import type { ChatEvent } from './events';

/**
 * How a run's events reach the browser (CHAT-00, CHAT-03 item 21). The engine
 * keeps every event (chat_run_events) and, in the process that drives the
 * run, hands each one at once to whoever listens here; a response tails a
 * run: the kept events after the last one the browser got, then the live
 * ones, or, when another process drives the run, the kept ones as they land.
 * The stream ends when the run waits on the person or ends. Server only.
 */

/** What a listener hears: an event, or the end of the run's work for now. */
type HubMessage = { kind: 'event'; event: ChatEvent } | { kind: 'end' };
type Listener = (message: HubMessage) => void;

const listeners = new Map<string, Set<Listener>>();
/** The runs this process drives now, with the switch that stops each one. */
const drivers = new Map<string, AbortController>();

/** Hands an event to the run's listeners in this process. */
export function publishRunEvent(runId: string, event: ChatEvent): void {
  for (const listener of listeners.get(runId) ?? []) listener({ kind: 'event', event });
}

/** Tells the run's listeners its work stopped for now: it waits, or it ended. */
export function publishRunEnd(runId: string): void {
  for (const listener of listeners.get(runId) ?? []) listener({ kind: 'end' });
}

function listen(runId: string, listener: Listener): () => void {
  const set = listeners.get(runId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(runId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(runId);
  };
}

/** Marks a run as driven here; the controller's abort is its Stop. */
export function registerDriver(runId: string): AbortController {
  const controller = new AbortController();
  drivers.set(runId, controller);
  return controller;
}

export function unregisterDriver(runId: string, controller: AbortController): void {
  if (drivers.get(runId) === controller) drivers.delete(runId);
}

/** Whether this process drives the run now. */
export function drivenHere(runId: string): boolean {
  return drivers.has(runId);
}

/** Stops a run this process drives: true when it was driven here. */
export function abortDriver(runId: string): boolean {
  const controller = drivers.get(runId);
  if (!controller) return false;
  controller.abort();
  return true;
}

/** How a tail reads what was kept, and whether the run still works (engineStore.ts). */
export interface TailSource {
  readEvents(runId: string, afterSeq: number): Promise<ChatEvent[]>;
  /** True while the run is queued or running. */
  isWorking(runId: string): Promise<boolean>;
}

/** How often a tail of a run driven elsewhere looks for new events. */
export const TAIL_POLL_MS = 1_000;
/** The longest a tail stays open (a function's own time limit is 300 s). */
export const TAIL_MAX_MS = 290_000;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * A run's events after `afterSeq`, in order, each once, until the run waits
 * on the person or ends. Starts listening before it reads what was kept, so
 * nothing published in between is lost; an event already read is skipped.
 * Opened before the run's driver starts, it hears the run from its first
 * event. `signal` ends it early (the browser went away).
 */
export function tailRunEvents(
  runId: string,
  afterSeq: number,
  source: TailSource,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const queue: HubMessage[] = [];
  let wake: (() => void) | null = null;
  const stop = listen(runId, (message) => {
    queue.push(message);
    wake?.();
  });

  async function* run(): AsyncGenerator<ChatEvent> {
    let last = afterSeq;
    const started = Date.now();
    try {
      for (const event of await source.readEvents(runId, last)) {
        if (event.seq > last) {
          last = event.seq;
          yield event;
        }
      }
      while (!signal?.aborted && Date.now() - started < TAIL_MAX_MS) {
        if (queue.length > 0) {
          const message = queue.shift()!;
          if (message.kind === 'end') return;
          if (message.event.seq > last) {
            last = message.event.seq;
            yield message.event;
          }
          continue;
        }
        if (!drivenHere(runId)) {
          // Driven elsewhere, or not at all: what was kept, until it stops working.
          const working = await source.isWorking(runId);
          for (const event of await source.readEvents(runId, last)) {
            if (event.seq > last) {
              last = event.seq;
              yield event;
            }
          }
          if (!working) return;
          await sleep(TAIL_POLL_MS, signal);
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, TAIL_POLL_MS);
        });
        wake = null;
      }
    } finally {
      stop();
    }
  }
  return run();
}

const encoder = new TextEncoder();

/** One event as Server-Sent Events: its seq as the id, so EventSource resumes after it. */
export function sseFrame(event: ChatEvent): string {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** A keep-alive comment, every 15 s, so a proxy doesn't close a quiet stream. */
const KEEP_ALIVE_MS = 15_000;

/** A streamed response of a run's events (text/event-stream). */
export function sseResponse(
  events: AsyncGenerator<ChatEvent>,
  headers: Record<string, string> = {},
): Response {
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          // Closed.
        }
      }, KEEP_ALIVE_MS);
    },
    async pull(controller) {
      try {
        const next = await events.next();
        if (next.done) {
          if (keepAlive) clearInterval(keepAlive);
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(sseFrame(next.value)));
      } catch (err) {
        console.error('[chat/stream] a run stream failed:', err);
        if (keepAlive) clearInterval(keepAlive);
        controller.close();
      }
    },
    async cancel() {
      if (keepAlive) clearInterval(keepAlive);
      // The run goes on: only this tail stops (CHAT-03 item 21).
      await events.return(undefined);
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...headers,
    },
  });
}

/**
 * Reads a stream of Server-Sent Events into Chat events, for the browser:
 * every `data:` line that holds an event, in order. Unknown or broken lines
 * are skipped. `signal` stops it: the stream is cancelled and it ends (the
 * page that read it went away).
 */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const cancel = () => void reader.cancel().catch(() => {});
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end = buffer.indexOf('\n\n');
      while (end !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6))
          .join('\n');
        if (data) {
          try {
            yield JSON.parse(data) as ChatEvent;
          } catch {
            // A broken frame: skipped.
          }
        }
        end = buffer.indexOf('\n\n');
      }
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
