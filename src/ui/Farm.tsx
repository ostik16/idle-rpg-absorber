import { constantSection } from '../data/game-data';
import { dropLevelModifier } from '../game/formulas';
import { Icon } from './Icon';
import {
  areaEnemies,
  requireGameData,
  closeArea,
  formatDuration,
  listAreas,
  openArea,
  openAreaId,
  roster,
  selectedCharacter,
  send,
  type AreaEnemyView,
  type AreaListEntry,
  type CharacterView,
} from './store';

/** The area's drop range for a character (design 3.8): the level modifier at both ends of the area's level range. */
function dropRange(level: number, area: AreaListEntry): { text: string; tone: 'full' | 'partial' | 'none' } {
  const ends = [area.levelMin, area.levelMax].map((enemyLevel) => Math.round(dropLevelModifier(level, enemyLevel) * 100));
  const low = Math.min(...ends);
  const high = Math.max(...ends);
  return {
    text: low === high ? `Drops ${high}%` : `Drops ${low}–${high}%`,
    tone: high <= 10 ? 'none' : low >= 100 ? 'full' : 'partial',
  };
}

function threat(level: number, area: AreaListEntry, name: string): { text: string; warn: boolean } {
  return area.levelMax > level
    ? { text: `Up to +${area.levelMax - level} levels`, warn: true }
    : { text: `All at or below ${name}`, warn: false };
}

function AreaCard({ area, view }: { area: AreaListEntry; view: CharacterView }) {
  const level = view.level.value;
  const drop = dropRange(level, area);
  const risk = threat(level, area, view.name);
  const farmers = roster.value.filter((other) => other.areaId.value === area.id).map((other) => other.name);
  return (
    <button type="button" class="ab-card app__area" onClick={() => openArea(area.id)}>
      <span class="app__area-top">
        <span class="ab-title">{area.name}</span>
        <span class="ab-level ab-level--enemy">
          Lv {area.levelMin}–{area.levelMax}
        </span>
        <span class={`ab-drop ab-drop--${drop.tone}`}>{drop.text}</span>
      </span>
      <span class="app__area-meta ab-num ab-c-muted">
        <span class="app__area-walk">
          <Icon name="travelling" size={14} />
          {formatDuration(area.distanceFromCity * 1000)} walk
        </span>
        <span class={risk.warn ? 'ab-c-warning' : undefined}>{risk.text}</span>
      </span>
      {farmers.length > 0 && <span class="app__text ab-c-muted">{farmers.join(', ')} farming here</span>}
    </button>
  );
}

/**
 * Radios for "Any enemy" and one row per listed enemy (design 3.3). Targeting a mob unlocks at
 * `farming.targeting.unlockKills` kills of it (decisions A3); a locked mob shows its kill progress and cannot be picked.
 */
export function TargetPicker({
  areaId,
  searchSeconds,
  value,
  kills,
  onPick,
}: {
  areaId: string;
  searchSeconds: number;
  value: string | null;
  kills: Readonly<Record<string, number>>;
  onPick: (enemyId: string | null) => void;
}) {
  const enemies = areaEnemies(areaId);
  const unlockKills = constantSection(requireGameData(), 'farming').targeting.unlockKills;
  const row = (id: string | null, name: string, sub: string, locked: boolean, enemy?: AreaEnemyView) => (
    <label class={`app__target${locked ? ' app__target--locked' : ''}`} key={id ?? 'any'}>
      <input type="radio" name={`target-${areaId}`} checked={value === id} disabled={locked} onChange={() => onPick(id)} />
      <span class="app__target-body">
        <span class="ab-num">{name}</span>
        <span class="app__field-help ab-c-muted">{sub}</span>
        {enemy !== undefined && enemy.traits.length > 0 && (
          <span class="app__tags">
            {enemy.traits.map((trait) => (
              <span class={`ab-tag${trait.magical ? ' ab-tag--magic' : ''}`} key={trait.name}>
                {trait.magical && <Icon name="absorption" size={14} />}
                {trait.name} {trait.value}%
              </span>
            ))}
          </span>
        )}
      </span>
    </label>
  );
  const between = (multiplier: number) => `${formatDuration(Math.round(searchSeconds * multiplier * 1000))} between fights`;
  return (
    <fieldset class="app__targets">
      <legend class="ab-label">Target</legend>
      {row(null, 'Any enemy', between(1), false)}
      {enemies.map((enemy) => {
        const killed = kills[enemy.id] ?? 0;
        const locked = killed < unlockKills;
        return row(
          enemy.id,
          `${enemy.name} · Lv ${enemy.level}`,
          locked
            ? `${killed} / ${unlockKills} kills to unlock`
            : `Targeting ×${enemy.targetingMultiplier} · ${between(enemy.targetingMultiplier)}`,
          locked,
          enemy,
        );
      })}
    </fieldset>
  );
}

function AreaSheet({ area, view }: { area: AreaListEntry; view: CharacterView }) {
  const drop = dropRange(view.level.value, area);
  const refusal = view.sendRefusal.value;
  const sendIt = () => {
    send({ type: 'sendToArea', characterId: view.id, areaId: area.id });
    closeArea();
  };
  return (
    <div
      class="ab-scrim app__scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) closeArea();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') closeArea();
      }}
    >
      <section class="ab-sheet app__sheet app__sheet--tall" role="dialog" aria-modal="true" aria-labelledby="area-title">
        <span class="ab-sheet__grip" aria-hidden="true" />
        <div class="app__field-head">
          <div class="app__grow">
            <h2 id="area-title" class="app__sheet-title">
              {area.name}
            </h2>
            <div class="app__field-help ab-c-muted">
              Lv {area.levelMin}–{area.levelMax} · for {view.name}, Lv {view.level.value}
            </div>
          </div>
          <button type="button" class="ab-btn ab-btn--ghost ab-btn--icon" aria-label="Close" onClick={closeArea}>
            <svg class="ab-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
            </svg>
          </button>
        </div>
        <span class={`ab-drop ab-drop--${drop.tone}`}>{drop.text}</span>
        <div class="ab-sheet__actions">
          <button type="button" class="ab-btn ab-btn--primary ab-btn--block" onClick={sendIt} disabled={refusal !== null}>
            Send {view.name}
          </button>
        </div>
        <p class="app__field-help ab-c-muted">
          {refusal ?? `Arrives in ${formatDuration(area.distanceFromCity * 1000)} on foot.`}
        </p>
      </section>
    </div>
  );
}

export function Farm() {
  const view = selectedCharacter.value;
  if (view === null) {
    return (
      <section class="ab-card">
        <p class="app__text">No characters yet.</p>
      </section>
    );
  }
  const areas = listAreas();
  const open = areas.find((area) => area.id === openAreaId.value);
  return (
    <section class="app__stack">
      <p class="app__field-help ab-c-muted">
        Drop rates and travel times for {view.name} · Lv {view.level.value}
      </p>
      {areas.map((area) => (
        <AreaCard key={area.id} area={area} view={view} />
      ))}
      {open !== undefined && <AreaSheet key={open.id} area={open} view={view} />}
    </section>
  );
}
