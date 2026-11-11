import { useState } from 'preact/hooks';
import { constantSection } from '../data/game-data';
import { proficiencyTitle, type ProficiencyId } from '../game/proficiency';
import { pointMarks, respawnHealth, xpToNextLevel } from '../game/progression';
import type { AttributeId } from '../game/stats';
import { formatGold, inCity, phaseDescriptor } from './format';
import { Icon } from './Icon';
import { BagGrid, ItemSlot } from './ItemSlot';
import { hrefFor } from './router';
import { TargetPicker } from './Farm';
import {
  areaEnemies,
  areaOf,
  equipmentSlots,
  formatDuration,
  itemInfo,
  listAreas,
  openSettings,
  restockablePotions,
  requireGameData,
  send,
  openDeleteConfirm,
  selectedCharacter,
  type CharacterView,
  type LootKind,
} from './store';

const pct = (value: number, max: number): number => (max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0);

/** The point-award marks as percentages of the level (design 4.4), so the XP bar's ticks match the "next point" label. */
function pointTicks(): number[] {
  return constantSection(requireGameData(), 'points').characterPointAwardAtLevelFraction.map((f) => Math.round(f * 100));
}

function Bar({ kind, label, value, max, text, ticks }: {
  kind: 'hp' | 'mana' | 'xp';
  label: string;
  value: number;
  max: number;
  text: string;
  ticks?: readonly number[];
}) {
  const width = pct(value, max);
  return (
    <div class={`ab-bar ab-bar--${kind}`}>
      <div class="ab-bar__head">
        <span>{label}</span>
        <span class="ab-bar__value">{text}</span>
      </div>
      <div class="ab-bar__track" role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={Math.round(max)}>
        <div class="ab-bar__fill" style={{ width: `${width}%` }} />
        {ticks?.map((at) => <span class="ab-bar__tick" style={{ left: `${at}%` }} key={at} />)}
      </div>
    </div>
  );
}

function Vitals({ view, xpOnly = false }: { view: CharacterView; xpOnly?: boolean }) {
  const next = xpToNextLevel(view.level.value);
  const xp = view.xpInLevel.value;
  const now = Math.floor(pct(xp, next));
  const mark = pointMarks(next).map((m) => Math.round(pct(m, next))).find((m) => m > now);
  return (
    <>
      <Bar kind="xp" label={`XP · Lv ${view.level.value}`} value={xp} max={next} text={mark === undefined ? `${now}%` : `${now}% · next point at ${mark}%`} ticks={pointTicks()} />
      {!xpOnly && (
        <>
          <Bar kind="hp" label="Health" value={view.health.value} max={view.maxHealth.value} text={`${view.health.value} / ${view.maxHealth.value}`} />
          <Bar kind="mana" label="Mana" value={view.mana.value} max={view.maxMana.value} text={`${view.mana.value} / ${view.maxMana.value}`} />
        </>
      )}
    </>
  );
}

const LOOT_TONE: Record<LootKind, string> = {
  kill: 'ab-c-xp',
  xp: 'ab-c-xp',
  gold: 'ab-c-gold',
  item: '',
  levelUp: 'ab-c-gold',
  death: 'ab-c-danger',
  xpLost: 'ab-c-danger',
  bagFull: 'ab-c-warning',
};

function LootFeed({ view }: { view: CharacterView }) {
  const lines = view.loot.value.slice(0, 8);
  return (
    <section class="ab-card" aria-labelledby="loot-h">
      <h2 id="loot-h" class="ab-label app__card-title">Loot</h2>
      {lines.length === 0 ? (
        <p class="app__text ab-c-muted">Nothing yet.</p>
      ) : (
        <ol class="ab-feed">
          {lines.map((line) => (
            <li class="ab-feed__row" key={line.id}>
              <span class="ab-feed__time" />
              <span class={LOOT_TONE[line.kind]}><Icon name={line.icon} size={16} /></span>
              <span>{line.text}</span>
              <span class={`ab-feed__amt ${LOOT_TONE[line.kind]}`}>{line.amount}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AreaBlock({ view }: { view: CharacterView }) {
  const [picking, setPicking] = useState(false);
  const areaId = view.areaId.value;
  const area = areaId === null ? null : areaOf(areaId);
  const entry = listAreas().find((row) => row.id === areaId);
  if (area === null || entry === undefined) return null;
  const targetId = view.targetEnemyId.value;
  const targetName = areaEnemies(area.id).find((enemy) => enemy.id === targetId)?.name ?? 'any enemy';
  return (
    <section class="ab-card app__stack" aria-label="Area">
      <div>
        <span class="ab-title">{area.name}</span>
        <div class="app__field-help ab-c-muted">Lv {area.levelMin}–{area.levelMax} · Target: {targetName}</div>
      </div>
      <div class="ab-sheet__actions app__actions--flat">
        <button type="button" class="ab-btn" onClick={() => setPicking(!picking)}>
          <Icon name="targetEnemy" size={16} /> Target enemy
        </button>
        <a class="ab-btn" href={hrefFor('farm')}>Change area</a>
      </div>
      {picking && (
        <TargetPicker
          areaId={area.id}
          searchSeconds={entry.searchSeconds}
          value={targetId}
          kills={view.kills.value}
          onPick={(enemyId) => send({ type: 'setTarget', characterId: view.id, enemyId })}
        />
      )}
    </section>
  );
}

function Dead({ view }: { view: CharacterView }) {
  const death = constantSection(requireGameData(), 'death');
  const total = view.phaseTotalMs.value ?? 0;
  const elapsed = Math.min(total, view.phaseElapsedMs.value);
  const next = xpToNextLevel(view.level.value);
  return (
    <>
      <section class="ab-card app__stack" aria-labelledby="back-h">
        <h2 id="back-h" class="ab-label">Back on its feet in</h2>
        <div class="ab-num app__big">{formatDuration(Math.max(0, total - elapsed))}</div>
        <div class="ab-bar">
          <div class="ab-bar__head">
            <span>Respawn</span>
            <span class="ab-bar__value">{formatDuration(elapsed)} of {formatDuration(total)}</span>
          </div>
          <div class="ab-bar__track" role="progressbar" aria-label="Respawn timer" aria-valuenow={Math.round(pct(elapsed, total))} aria-valuemin={0} aria-valuemax={100}>
            <div class="ab-bar__fill" style={{ width: `${pct(elapsed, total)}%` }} />
          </div>
        </div>
      </section>
      <section class="ab-card app__stack" aria-labelledby="heal-h">
        <h2 id="heal-h" class="ab-label">Then it waits in the city</h2>
        <dl class="ab-dl">
          <dt>Respawns with</dt>
          <dd>{Math.round(death.respawnHealthFraction * 100)}% · {respawnHealth(view.maxHealth.value, death)} / {view.maxHealth.value}</dd>
        </dl>
        <p class="app__field-help ab-c-muted">{view.name} regenerates there until you send it out again.</p>
      </section>
      <section class="ab-card app__stack" aria-labelledby="lost-h">
        <h2 id="lost-h" class="ab-label">What was lost</h2>
        <Bar kind="xp" label={`XP · Lv ${view.level.value}`} value={view.xpInLevel.value} max={next} text={`${Math.floor(pct(view.xpInLevel.value, next))}%`} ticks={pointTicks()} />
        <p class="app__field-help ab-c-muted">
          XP never falls below the last point mark {view.name} passed in this level, and a level is never lost. Bag and gear are kept: nothing is lost except XP.
        </p>
      </section>
    </>
  );
}

/** The player's drink command (decisions A1): the city heals by regeneration only, so potions are drunk by hand. */
function DrinkRows({ view }: { view: CharacterView }) {
  const full = view.health.value >= view.maxHealth.value;
  // Health potions are the consumables with a drink-at threshold; buffs have none.
  return (
    <>
      {restockablePotions()
        .filter((potion) => potion.autoUseDefaultThreshold !== null)
        .map((potion) => {
          const qty = view.bag.value.filter((s) => s.itemId === potion.id).reduce((sum, s) => sum + s.qty, 0);
          if (qty === 0) return null;
          return (
            <div class="app__field-head" key={potion.id}>
              <span class="ab-num app__grow">{qty} {potion.name}</span>
              <button type="button" class="ab-btn ab-btn--sm" disabled={full} onClick={() => send({ type: 'drinkPotion', characterId: view.id, itemId: potion.id })}>
                Drink
              </button>
            </div>
          );
        })}
    </>
  );
}

function Farm({ view }: { view: CharacterView }) {
  const phase = view.activity.value;
  const returning = phase === 'fleeing' || phase === 'returning';
  const out = phase === 'searching' || phase === 'fighting' || phase === 'looting' || phase === 'travelling';
  if (phase === 'dead') return <Dead view={view} />;
  if (phase === 'idle' || phase === 'restocking') {
    return (
      <section class="ab-card app__stack">
        <p class="app__text">{view.name} is in the city.</p>
        <Vitals view={view} />
        <DrinkRows view={view} />
        <a class="ab-btn ab-btn--primary" href={hrefFor('farm')}>Choose an area</a>
      </section>
    );
  }
  const area = view.areaId.value === null ? null : areaOf(view.areaId.value);
  return (
    <>
      <section class="ab-card app__stack">
        {phase === 'travelling' && (
          <>
            <h2 class="ab-label">Travelling</h2>
            <div class="ab-num app__big">{view.timeInActivity}</div>
            <p class="app__text">To {area?.name ?? 'the area'}</p>
          </>
        )}
        {returning && <p class="app__text">Heading back to the city.</p>}
        <Vitals view={view} />
        {out && (
          <button type="button" class="ab-btn ab-btn--block" onClick={() => send({ type: 'returnToCity', characterId: view.id })}>
            <Icon name="returnToCity" size={16} /> Return to city
          </button>
        )}
      </section>
      {(phase === 'searching' || phase === 'fighting' || phase === 'looting') && <AreaBlock view={view} />}
      {phase !== 'travelling' && <LootFeed view={view} />}
    </>
  );
}

const ATTRIBUTES: Record<AttributeId, { name: string; feeds: string }> = {
  strength: { name: 'Strength', feeds: 'Physical damage' },
  dexterity: { name: 'Dexterity', feeds: 'Attack speed, critical chance' },
  vitality: { name: 'Vitality', feeds: 'Health, defence' },
  intelligence: { name: 'Intelligence', feeds: 'Mana, spell damage' },
};

const PROFICIENCIES: Record<ProficiencyId, string> = {
  'two-handed': 'Two-handed',
  'one-handed': 'One-handed',
  unarmed: 'Unarmed',
  toughness: 'Toughness',
  combat: 'Combat',
  speed: 'Speed',
};

type Pending = Partial<Record<AttributeId, number>>;

function Stats({ view }: { view: CharacterView }) {
  const [pending, setPending] = useState<Pending>({});
  const used = Object.values(pending).reduce((sum, n) => sum + n, 0);
  const left = view.unspentPoints.value - used;
  const stats = view.derived.value;
  const titles = constantSection(requireGameData(), 'proficiency').titles;
  const confirm = () => {
    for (const [attribute, amount] of Object.entries(pending)) {
      if (amount > 0) send({ type: 'spendCharacterPoints', characterId: view.id, attribute: attribute as AttributeId, amount }, { saveAfter: true });
    }
    setPending({});
  };
  return (
    <>
      <section class="ab-card app__stack" aria-labelledby="attr-h">
        <div class="app__field-head">
          <h2 id="attr-h" class="ab-label app__grow">Attributes</h2>
          <span class="ab-num ab-c-gold">{left} {left === 1 ? 'point' : 'points'} left</span>
        </div>
        {(Object.keys(ATTRIBUTES) as AttributeId[]).map((id) => (
          <div class="app__attr" key={id}>
            <div class="app__target-body">
              <span class="ab-num">{ATTRIBUTES[id].name}</span>
              <span class="app__field-help ab-c-muted">{ATTRIBUTES[id].feeds}</span>
            </div>
            <span class="ab-num">
              {view.attributes.value[id] + (pending[id] ?? 0)}
              {(pending[id] ?? 0) > 0 && <span class="ab-c-gold"> +{pending[id]}</span>}
            </span>
            <button
              type="button"
              class="ab-btn ab-btn--icon"
              aria-label={`Add a point to ${ATTRIBUTES[id].name}`}
              disabled={left === 0}
              onClick={() => setPending({ ...pending, [id]: (pending[id] ?? 0) + 1 })}
            >
              +
            </button>
          </div>
        ))}
        {used > 0 && (
          <>
            <p class="app__field-help ab-c-muted">{used} {used === 1 ? 'point' : 'points'} to spend. Points are permanent.</p>
            <div class="ab-sheet__actions app__actions--flat">
              <button type="button" class="ab-btn ab-btn--ghost" onClick={() => setPending({})}>Clear</button>
              <button type="button" class="ab-btn ab-btn--primary" onClick={confirm}>Confirm</button>
            </div>
          </>
        )}
      </section>
      <section class="ab-card app__stack" aria-labelledby="der-h">
        <h2 id="der-h" class="ab-label">Derived</h2>
        <dl class="ab-dl">
          <dt>Damage</dt><dd>{Math.round(stats.damage)}</dd>
          <dt>Health</dt><dd>{Math.ceil(stats.maxHealth)}</dd>
          <dt>Attack speed</dt><dd>{stats.attacksPerSecond.toFixed(2)} / s</dd>
          <dt>Defence</dt><dd>{Math.round(stats.defence)}</dd>
          <dt>Crit chance</dt><dd>{(stats.critChance * 100).toFixed(1)}%</dd>
          <dt>Mana</dt><dd>{Math.ceil(stats.maxMana)}</dd>
          <dt>Travel speed</dt><dd>{Math.round(stats.movementSpeed * 100)}%</dd>
          <dt>Spell damage</dt><dd>+{Math.round((stats.spellDamageMultiplier - 1) * 100)}%</dd>
        </dl>
      </section>
      <section class="ab-card" aria-labelledby="prof-h">
        <h2 id="prof-h" class="ab-label app__card-title">Proficiency</h2>
        <p class="app__field-help ab-c-muted">Rises as {view.name} fights, takes hits and travels. Exact values stay hidden.</p>
        {(Object.keys(PROFICIENCIES) as ProficiencyId[]).map((id) => {
          const title = proficiencyTitle(view.proficiency.value[id]);
          const tier = titles.indexOf(title);
          return (
            <div class="ab-prof" key={id}>
              <span class="ab-prof__skill">{PROFICIENCIES[id]}</span>
              <span class="ab-prof__title">{title}</span>
              <span class="ab-prof__pips" role="img" aria-label={`${title}, ${tier + 1} of ${titles.length}`}>
                {titles.map((name, i) => <span class={`ab-prof__pip${i <= tier ? ' ab-prof__pip--on' : ''}`} key={name} />)}
              </span>
            </div>
          );
        })}
      </section>
    </>
  );
}

/** The slot an item of this type goes in: the first empty one that fits, else the first that fits (rings have two). */
function slotFor(view: CharacterView, equipmentType: string | null): string | null {
  const fits = equipmentSlots().filter((slot) => equipmentType !== null && slot.allowedTypes.includes(equipmentType));
  return (fits.find((slot) => view.equipment.value[slot.id] === undefined) ?? fits[0])?.id ?? null;
}

function Gear({ view }: { view: CharacterView }) {
  const [picked, setPicked] = useState<number | null>(null);
  const here = inCity(view.activity.value);
  const bag = view.bag.value;
  const worn = view.equipment.value;
  const twoHanded = itemInfo(worn['main-hand']?.itemId ?? '').equipmentType === 'two-handed-weapon';
  const stack = picked === null ? undefined : bag[picked];
  const info = stack === undefined ? null : itemInfo(stack.itemId);
  const slotId = info === null || info.category !== 'equipment' ? null : slotFor(view, info.equipmentType);
  const slotLabel = equipmentSlots().find((slot) => slot.id === slotId)?.label;
  const tooLow = info !== null && (info.requiredLevel ?? 1) > view.level.value;
  const packId = worn['backpack']?.itemId;
  return (
    <>
      {!here && <p class="app__field-help ab-c-warning">{view.name} has to be in the city to change gear.</p>}
      <button type="button" class="ab-btn ab-btn--block" onClick={() => openSettings(view.id)}>
        <Icon name="lootFilter" /> Loot filter
      </button>
      <section class="ab-card app__stack" aria-labelledby="eq-h">
        <h2 id="eq-h" class="ab-label">Equipped</h2>
        <div class="app__paper">
          {equipmentSlots().map((slot) => {
            const item = worn[slot.id];
            const blocked = slot.id === 'off-hand' && twoHanded;
            return (
              <div class="app__gear-slot" key={slot.id}>
                {blocked ? (
                  <span class="ab-slot ab-slot--locked" role="img" aria-label="Off hand blocked by a two-handed weapon"><Icon name="locked" /></span>
                ) : item === undefined ? (
                  <ItemSlot stack={null} />
                ) : (
                  <ItemSlot stack={item} onClick={here ? () => send({ type: 'unequipItem', characterId: view.id, slot: slot.id }, { saveAfter: true }) : undefined} />
                )}
                <span class="app__target-body">
                  <span class="ab-label">{slot.label}</span>
                  <span class="app__field-help ab-c-muted">{blocked ? 'Blocked by a two-handed weapon' : item === undefined ? 'Empty' : itemInfo(item.itemId).name}</span>
                </span>
              </div>
            );
          })}
        </div>
      </section>
      <section class="ab-card app__stack" aria-labelledby="bag-h">
        <div class="app__field-head">
          <h2 id="bag-h" class="ab-label app__grow">Bag</h2>
          <span class="ab-num">{view.bagUsedCells.value}/{view.bagCapacity.value}</span>
        </div>
        <BagGrid label={`${view.name}'s bag`} stacks={bag} capacity={view.bagCapacity.value} used={view.bagUsedCells.value} selected={new Set(picked === null ? [] : [picked])} onToggle={(i) => setPicked(picked === i ? null : i)} />
        <p class="app__field-help ab-c-muted">
          Max stack {view.bagMaxStack.value}{packId === undefined ? ', no backpack' : `, set by the ${itemInfo(packId).name}`}.
        </p>
        {info !== null && picked !== null && (
          <div class="app__stack">
            <span class="ab-num">{info.name}{stack !== undefined && stack.qty > 1 ? ` ×${stack.qty}` : ''}</span>
            {slotId === null ? (
              <p class="app__field-help ab-c-muted">Not equipment.</p>
            ) : (
              <>
                {tooLow && <p class="app__field-help ab-c-warning">Needs Lv {info.requiredLevel}.</p>}
                <button
                  type="button"
                  class="ab-btn ab-btn--primary ab-btn--block"
                  disabled={!here || tooLow}
                  onClick={() => {
                    send({ type: 'equipItem', characterId: view.id, bagIndex: picked, slot: slotId }, { saveAfter: true });
                    setPicked(null);
                  }}
                >
                  Equip in {slotLabel}
                </button>
              </>
            )}
          </div>
        )}
      </section>
    </>
  );
}

export function CharacterScreen() {
  const [tab, setTab] = useState<'farm' | 'stats' | 'gear'>('farm');
  const view = selectedCharacter.value;
  if (view === null) return null;
  const status = phaseDescriptor(view.activity.value);
  const area = view.areaId.value === null ? null : areaOf(view.areaId.value);
  return (
    <section class="app__stack">
      <div class="app__field-head">
        <span class={`ab-status ab-status--${status.modifier}`}>
          <Icon name={status.icon} size={14} />
          {status.label}
          {view.activity.value !== 'idle' && <span class="ab-status__time">{view.timeInActivity}</span>}
        </span>
        <span class="app__field-help ab-c-muted app__grow">{area === null ? 'In the city' : `${area.name} · Lv ${area.levelMin}–${area.levelMax}`}</span>
        <span class="ab-c-gold ab-num"><Icon name="gold" size={14} /> {formatGold(view.gold.value)}</span>
      </div>
      <div class="ab-seg" role="tablist" aria-label="Character view">
        <button type="button" role="tab" class="ab-seg__item" aria-selected={tab === 'farm'} onClick={() => setTab('farm')}>Farm</button>
        <button type="button" role="tab" class="ab-seg__item" aria-selected={tab === 'stats'} onClick={() => setTab('stats')}>
          Stats{view.unspentPoints.value > 0 && <span class="ab-c-gold" aria-label={`${view.unspentPoints.value} points to spend`}>&nbsp;{view.unspentPoints.value}</span>}
        </button>
        <button type="button" role="tab" class="ab-seg__item" aria-selected={tab === 'gear'} onClick={() => setTab('gear')}>Gear</button>
      </div>
      {tab === 'farm' ? <Farm view={view} /> : tab === 'stats' ? <Stats view={view} /> : <Gear view={view} />}
      <button type="button" class="ab-btn ab-btn--ghost ab-btn--block" onClick={() => openDeleteConfirm(view.id)}>
        Delete {view.name}
      </button>
    </section>
  );
}
