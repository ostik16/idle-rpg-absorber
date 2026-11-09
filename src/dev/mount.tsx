import { render } from 'preact';
import type { GameData } from '../data/game-data';
import type { Engine } from '../engine/engine';
import { DevPanel, type LoggedEvent } from './DevPanel';
import './dev.css';

const EVENT_LIMIT = 30;

/** Opens the dev panel (#74). Only `start-game` calls it, and only when `import.meta.env.DEV` is set. */
export function mountDevTools(engine: Engine, data: GameData): void {
  const events: LoggedEvent[] = [];
  let counter = 0;
  // The store drains the engine's events every refresh, so the panel keeps its own copy of the latest ones.
  const drain = engine.drainEvents.bind(engine);
  engine.drainEvents = () => {
    const drained = drain();
    for (const event of drained) events.push({ id: counter++, event });
    events.splice(0, Math.max(0, events.length - EVENT_LIMIT));
    return drained;
  };
  const root = document.createElement('div');
  document.body.append(root);
  render(<DevPanel engine={engine} data={data} events={events} />, root);
}
