/** Entry helper for the scripts. Uses globalThis so the typecheck needs no Node typings. */
import { BalanceError } from './load-data';

interface ProcessLike {
  argv: string[];
  exitCode?: number;
}

function proc(): ProcessLike {
  const p = (globalThis as { process?: ProcessLike }).process;
  if (!p) throw new Error('These tools run under Node (vite-node).');
  return p;
}

/** Runs `main` with the command line flags, prints what it returns, and turns BalanceError into a one-line message. */
export function runCli(main: (argv: string[]) => string): void {
  const p = proc();
  try {
    console.log(main(p.argv.slice(2)));
  } catch (e) {
    if (e instanceof BalanceError) {
      console.error(e.message);
      p.exitCode = 1;
      return;
    }
    throw e;
  }
}
