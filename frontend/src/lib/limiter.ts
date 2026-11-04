/**
 * Runs the tasks handed to it at most `max` at a time, in the order they
 * came: heavy reads that would otherwise all start at once. A task waiting
 * for a place takes the one a finished task leaves, so a task arriving in
 * between can't jump the line.
 */
export function createLimiter(max: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (running < max) running++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}
