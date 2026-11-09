import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { requireNumberConstant, type GameData } from '../data/game-data';
import type { DevAction } from '../engine/dev';
import type { Engine } from '../engine/engine';
import type { EngineEvent } from '../engine/events';
import { validatePayload } from '../save/schema';
import { createGameState } from '../state/factory';
import type { GameState } from '../state/types';
import { devNow, getSpeed, setSpeed, skipTime } from './clock';

const SPEEDS = [1, 5, 20, 100];
const SKIPS: readonly (readonly [string, number])[] = [
  ['1m', 60],
  ['10m', 600],
  ['1h', 3600],
  ['8h', 28_800],
];
const MS_PER_SECOND = 1000;
const REFRESH_MS = 500;
const DEFAULT_KILLS = 50;

/** An engine event with a running number, so the list can key on it while it shifts. */
export interface LoggedEvent {
  id: number;
  event: EngineEvent;
}

interface Props {
  engine: Engine;
  data: GameData;
  events: readonly LoggedEvent[];
}

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="dev__section">
      <span class="ab-label">{title}</span>
      {children}
    </section>
  );
}

/** A number box and the button that sends it. */
function NumberRow({ label, initial, onGo }: { label: string; initial: number; onGo: (value: number) => void }) {
  const [value, setValue] = useState(String(initial));
  return (
    <div class="dev__row">
      <input
        class="app__input dev__input"
        type="number"
        aria-label={label}
        value={value}
        onInput={(e) => setValue(e.currentTarget.value)}
      />
      <button type="button" class="ab-btn ab-btn--sm" onClick={() => onGo(Number(value))}>
        {label}
      </button>
    </div>
  );
}

function Select({ label, value, options, onPick }: { label: string; value: string; options: readonly string[]; onPick: (v: string) => void }) {
  return (
    <select class="app__input dev__input" aria-label={label} value={value} onChange={(e) => onPick(e.currentTarget.value)}>
      {options.map((id) => (
        <option key={id} value={id}>
          {id}
        </option>
      ))}
    </select>
  );
}

function hex(words: readonly number[]): string {
  return words.map((w) => (w >>> 0).toString(16).padStart(8, '0')).join(' ');
}

export function DevPanel({ engine, data, events }: Props) {
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);
  const [characterId, setCharacterId] = useState('');
  const [itemId, setItemId] = useState(String(data.items[0]?.id ?? ''));
  const [enemyId, setEnemyId] = useState(String(data.enemies[0]?.id ?? ''));
  const [saveText, setSaveText] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  // The engine runs outside Preact, so the panel reads it again on a timer while open.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => clearInterval(timer);
  }, [open]);

  if (!open) {
    return (
      <button type="button" class="ab-btn ab-btn--sm dev__toggle" onClick={() => setOpen(true)}>
        Dev tools
      </button>
    );
  }

  const roster = engine.state.roster;
  const character = roster.find((c) => c.id === characterId) ?? roster[0];
  const dev = (action: DevAction) => engine.dispatch({ type: 'dev', action });
  const forCharacter = (make: (id: string) => DevAction) => () => character && dev(make(character.id));
  const replaceState = (state: GameState) => dev({ kind: 'replaceState', state });
  const reset = () => {
    if (!window.confirm('Reset to a new game? The current save is overwritten.')) return;
    const [seed = 0] = crypto.getRandomValues(new Uint32Array(1));
    replaceState(createGameState(seed, devNow(), data));
  };
  const importSave = () => {
    let state: unknown;
    try {
      state = JSON.parse(saveText);
    } catch {
      return setSaveError('Not valid JSON.');
    }
    // shortcut: accepts the current payload shape only, with no migration or table reconcile; use a fresh export.
    const problem = validatePayload(state);
    if (problem !== null) return setSaveError(problem);
    (state as GameState).clock.lastSimulatedAt = devNow();
    setSaveError(null);
    replaceState(state as GameState);
  };

  return (
    <aside class="ab-card dev" aria-label="Dev tools">
      <div class="dev__head">
        <span class="ab-label">Dev tools</span>
        <button type="button" class="ab-btn ab-btn--ghost ab-btn--sm" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      <Section title="Time">
        <div class="dev__row">
          {SKIPS.map(([name, seconds]) => (
            <button key={name} type="button" class="ab-btn ab-btn--sm" onClick={() => skipTime(seconds * MS_PER_SECOND)}>
              +{name}
            </button>
          ))}
        </div>
        <span class="ab-c-muted">
          Skips run through the normal step. Past {requireNumberConstant(data, 'offline.stepSimMaxSeconds')}s they become an offline estimate.
        </span>
        <div class="ab-seg" role="tablist" aria-label="Speed">
          {SPEEDS.map((factor) => (
            <button
              key={factor}
              type="button"
              class="ab-seg__item"
              role="tab"
              aria-selected={getSpeed() === factor}
              onClick={() => setSpeed(factor)}
            >
              {factor}×
            </button>
          ))}
        </div>
      </Section>

      <Section title="Character">
        {character === undefined ? (
          <span class="ab-c-muted">No characters yet.</span>
        ) : (
          <>
            <Select label="Character" value={character.id} options={roster.map((c) => c.id)} onPick={setCharacterId} />
            <NumberRow label="Set level" initial={character.level + 1} onGo={(level) => forCharacter((id) => ({ kind: 'setLevel', characterId: id, level }))()} />
            <NumberRow label="Give XP" initial={1000} onGo={(amount) => forCharacter((id) => ({ kind: 'giveXp', characterId: id, amount }))()} />
            <NumberRow label="Give gold" initial={1000} onGo={(amount) => forCharacter((id) => ({ kind: 'giveGold', characterId: id, amount }))()} />
            <NumberRow label="Set health %" initial={50} onGo={(percent) => forCharacter((id) => ({ kind: 'setHealth', characterId: id, fraction: percent / 100 }))()} />
            <Select label="Item" value={itemId} options={data.items.map((r) => String(r.id))} onPick={setItemId} />
            <NumberRow label="Give item" initial={10} onGo={(qty) => forCharacter((id) => ({ kind: 'giveItem', characterId: id, itemId, qty }))()} />
            <button type="button" class="ab-btn ab-btn--sm" onClick={forCharacter((id) => ({ kind: 'removeItem', characterId: id, itemId }))}>
              Clear item from bag
            </button>
            <Select label="Enemy" value={enemyId} options={data.enemies.map((r) => String(r.id))} onPick={setEnemyId} />
            <NumberRow label="Set kills" initial={DEFAULT_KILLS} onGo={(kills) => forCharacter((id) => ({ kind: 'setKills', characterId: id, enemyId, kills }))()} />
          </>
        )}
      </Section>

      <Section title="Inspect">
        {character === undefined ? null : (
          <dl class="ab-dl dev__dl">
            <dt>Phase</dt>
            <dd>{character.phase} · {Math.floor(character.timeInPhaseMs / MS_PER_SECOND)}s</dd>
            <dt>Area</dt>
            <dd>{character.areaId ?? 'none'}</dd>
            <dt>Target</dt>
            <dd>{character.targetEnemyId ?? 'any'}</dd>
            {Object.entries(character.rng ?? {}).map(([stream, words]) => (
              <>
                <dt key={`${stream}-k`}>RNG {stream}</dt>
                <dd key={`${stream}-v`} class="dev__mono">{hex(words)}</dd>
              </>
            ))}
          </dl>
        )}
        <span class="ab-label">Last events</span>
        <ol class="dev__events">
          {events.slice(-10).reverse().map(({ id, event }) => (
            <li key={id} class="dev__mono">{JSON.stringify(event)}</li>
          ))}
        </ol>
      </Section>

      <Section title="Save">
        <div class="dev__row">
          <button type="button" class="ab-btn ab-btn--sm" onClick={() => setSaveText(JSON.stringify(engine.state))}>
            Export
          </button>
          <button type="button" class="ab-btn ab-btn--sm" onClick={importSave}>
            Import
          </button>
          <button type="button" class="ab-btn ab-btn--sm ab-btn--danger" onClick={reset}>
            New game
          </button>
        </div>
        <textarea
          class="app__input dev__text"
          aria-label="Raw save"
          value={saveText}
          onInput={(e) => setSaveText(e.currentTarget.value)}
        />
        {saveError !== null && <span class="ab-c-danger">{saveError}</span>}
      </Section>
    </aside>
  );
}
