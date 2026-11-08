/**
 * The offline estimator (ADR 0002 "Offline estimator"). The engine calls an `EstimateOffline`
 * for absences longer than `offline.stepSimMaxSeconds`.
 */
import { constantSection, requireNumberConstant, requireRow, type GameData } from '../data/game-data';
import { enemyCombatant, fightTick, type Combatant, type EnemyCombatStats } from '../game/combat';
import { bestiaryTier, killProficiencyGain, lifeStealHeal, quantiseToSteps, regenerationHeal } from '../game/formulas';
import { chooseAutoPotion, chooseCityPotion, cityPotionTarget, type HeldPotion } from '../game/potions';
import { addProficiency, type ProficiencyId } from '../game/proficiency';
import { levelUpReward, respawnHealth, type LevelUpRewardRow } from '../game/progression';
import { rollSpawn } from '../game/farming';
import { healthRegenPerSecond, type PotionTier } from '../game/stats';
import { derivedStats } from '../state/selectors';
import type { CharacterRngState, CharacterState, CharacterSummary, GameState, OfflineSummary, Phase } from '../state/types';
import { compareCharacterIds } from './character';
import { arriveInCity, isBagFull } from './city';
import { loseXpOnDeath, respawnDurationMs } from './death';
import { fleeDurationMs } from './fight';
import { absorbOnEnemyKill, trainedWeaponSkill } from './growth';
import { grantKillLoot, grantKillXp } from './rewards';
import type { StepContext } from './step-context';
import { createCharacterStreams, readStreamStates } from './streams';
import { searchDurationMs, travelDurationMs, type AreaRow } from './travel';

const MS_PER_SECOND = 1000;

/** What an estimator returns. The engine adds the seconds covered and the seconds discarded. */
export type OfflineEstimate = Pick<OfflineSummary, 'characters'>;

/**
 * Estimates `seconds` of farming for every character and applies the result to `state` (XP, items, ...).
 * `seconds` is already capped at `offline.capHours`. Yields are multiplied by `offline.efficiency` here, not
 * by the engine. The engine writes each character's stream states to `character.rng` before the call and
 * reads them back after it, so an estimator draws by restoring those states and saves them again when done.
 * Returns one summary per character.
 */
export type EstimateOffline = (state: GameState, seconds: number, data: GameData) => OfflineEstimate;

export function emptyCharacterSummary(characterId: string): CharacterSummary {
  return { characterId, kills: 0, xp: 0, gold: 0, items: {} };
}

interface PotionItemRow {
  effect?: { type?: string; tier?: string };
  autoUseDefaultThreshold?: number;
}

interface HeldStack extends HeldPotion {
  qty: number;
  durationSeconds: number;
}

/** The health potions in the bag, once per item, as `autoUsePotion` sees them (engine/healing.ts). */
function heldPotions(character: CharacterState, data: GameData): HeldStack[] {
  const held = new Map<string, HeldStack>();
  for (const { itemId, qty } of character.bag) {
    const known = held.get(itemId);
    if (known) {
      known.qty += qty;
      continue;
    }
    const item = requireRow(data, 'items', itemId) as unknown as PotionItemRow;
    if (item.effect?.type !== 'heal-over-time') continue;
    const tier = constantSection(data, 'potions').tiers.find((t) => t.id === item.effect?.tier);
    if (tier === undefined) continue;
    const threshold = character.settings.potionThresholds[itemId] ?? item.autoUseDefaultThreshold ?? 0;
    held.set(itemId, { itemId, qty, amount: tier.amount, durationSeconds: tier.durationSeconds, threshold });
  }
  return [...held.values()].filter((potion) => potion.qty > 0);
}

function takeFromBag(character: CharacterState, itemId: string): void {
  const index = character.bag.findIndex((stack) => stack.itemId === itemId && stack.qty > 0);
  const stack = character.bag[index];
  if (stack === undefined) return;
  stack.qty -= 1;
  if (stack.qty === 0) character.bag.splice(index, 1);
}

/** A potion being drunk: it heals `amount` evenly over `durationMs`, one after the other (design 2.6). */
interface DrinkingPotion {
  itemId: string;
  amount: number;
  durationMs: number;
  remainingMs: number;
}

/** Runs the potion queue for `ms` and returns what it healed. */
function deliver(queue: DrinkingPotion[], ms: number): number {
  let healed = 0;
  for (let left = ms; left > 0 && queue[0] !== undefined; ) {
    const head = queue[0];
    const used = Math.min(left, head.remainingMs);
    healed += (head.amount * used) / head.durationMs;
    head.remainingMs -= used;
    left -= used;
    if (head.remainingMs <= 0) queue.shift();
  }
  return healed;
}

const pendingOf = (queue: readonly DrinkingPotion[]): number =>
  queue.reduce((sum, potion) => sum + (potion.amount * potion.remainingMs) / potion.durationMs, 0);

type Leg = 'out' | 'field' | 'back' | 'heal' | 'dead';
const PHASE_OF_LEG: Readonly<Record<Leg, Phase>> = {
  out: 'travelling',
  field: 'searching',
  back: 'returning',
  heal: 'restocking',
  dead: 'dead',
};

interface FightResult {
  outcome: 'win' | 'loss' | 'fled';
  /** Steps until the kill, the death or the end of the flight. */
  ticks: number;
  health: number;
  playerHits: number;
  enemyHits: number;
  /** Potions drunk, to take out of the bag when the fight counts. */
  drunk: string[];
  /** The potion queue as the fight left it. */
  queue: DrinkingPotion[];
}

/**
 * Walks one character through its trips (farm, return, sell, restock, heal, go back out) for `budgetMs`, one event at a
 * time: a search, a fight, a trip home. Fights run on the real `fightTick` and rewards on the real kill code, so
 * loot, bag, XP, filters, auto-sell and restock are the live rules and only the waiting between events is arithmetic.
 *
 * shortcut: the potion queue, the health trigger and regeneration run per fight tick but without the live potion
 * tick (500 ms steps, not continuous) or the regeneration trait's pulses (a rate); upgrade when the drift report
 * shows it. A character mid-field when the absence began starts as if it had just left the city.
 */
function estimateCharacter(
  state: GameState,
  character: CharacterState,
  budgetMs: number,
  proficiencyRate: number,
  data: GameData,
): CharacterSummary {
  const summary = { ...emptyCharacterSummary(character.id), deaths: 0 };
  if (character.areaId === null || character.stayInCity) return summary;

  const tickMs = requireNumberConstant(data, 'combat.tickMs');
  const streams = createCharacterStreams(state.clock.masterSeed, character.id, character.rng);
  const rewards = data.levelUpRewards as unknown as readonly LevelUpRewardRow[];
  const ctx: StepContext = {
    data,
    tickMs,
    streams,
    emit: (event) => {
      if (event.type === 'enemyKilled') {
        summary.kills += 1;
        const kills = (state.bestiary.kills[character.id] ??= {});
        const count = (kills[event.enemyId] = (kills[event.enemyId] ?? 0) + 1);
        const tier = bestiaryTier(count, data.bestiaryThresholds as unknown as { kills: number }[]);
        state.bestiary.revealed[event.enemyId] = Math.max(state.bestiary.revealed[event.enemyId] ?? 0, tier);
      } else if (event.type === 'xpGained') summary.xp += event.amount;
      else if (event.type === 'itemPickedUp') summary.items[event.itemId] = (summary.items[event.itemId] ?? 0) + event.qty;
      else if (event.type === 'characterDied') summary.deaths += 1;
      else if (event.type === 'levelUp') {
        const maxSlots = constantSection(data, 'characters').maxSlots;
        state.account.unlockedSlots = Math.min(maxSlots, state.account.unlockedSlots + levelUpReward(event.level, rewards).slotTickets);
      }
    },
  };
  const area = requireRow(data, 'areas', character.areaId) as unknown as AreaRow & { levelRange: { max: number } };
  const goldAtStart = character.gold;
  let elapsed = 0;
  let unfinished: Partial<CharacterRngState> = {};

  const vitals = () => {
    const stats = derivedStats(character, data);
    const traits = constantSection(data, 'traits');
    const regenPercent = character.absorption[traits.regenerationId] ?? 0;
    const perSecond =
      healthRegenPerSecond(stats.maxHealth, constantSection(data, 'stats')) +
      regenerationHeal(stats.maxHealth, regenPercent) / traits.regenerationIntervalSeconds;
    return { stats, max: stats.maxHealth, perSecond };
  };
  const train = (skill: ProficiencyId, enemyLevel: number, units: number): void => {
    const points = character.proficiency[skill];
    character.proficiency[skill] = addProficiency(points, killProficiencyGain(skill, points, enemyLevel, units) * proficiencyRate);
  };
  /** Walking (travel or search): trains speed, regenerates and runs the potions. */
  const walk = (ms: number): void => {
    const { max, perSecond } = vitals();
    train('speed', area.levelRange.max, ms / MS_PER_SECOND);
    character.health = Math.min(max, character.health + (perSecond * ms) / MS_PER_SECOND + deliver(queue, ms));
    elapsed += ms;
  };

  /** One fight on the real combat tick. Health trigger, flight and auto potions as in engine/character.ts. */
  const runFight = (enemyId: string): FightResult => {
    const row = requireRow(data, 'enemies', enemyId) as unknown as EnemyCombatStats;
    const { stats, max, perSecond } = vitals();
    const player: Combatant = {
      maxHp: max,
      damage: stats.damage,
      defence: stats.defence,
      critChance: stats.critChance,
      intervalMs: stats.attackIntervalMs,
    };
    const enemy = enemyCombatant(row, tickMs);
    const regenPerTick = (perSecond * tickMs) / MS_PER_SECOND;
    const lifeSteal = character.absorption[constantSection(data, 'traits').lifeStealId] ?? 0;
    const trigger = character.settings.returnHealthThreshold * max;
    const fleeTicks = fleeDurationMs(character, ctx) / tickMs;
    const held = heldPotions(character, data);
    const drunk: string[] = [];
    const fightQueue = queue.map((potion) => ({ ...potion }));
    let health = character.health;
    let enemyHp = row.health;
    let fleeingSince = -1;
    let playerHits = 0;
    let enemyHits = 0;
    for (let ticks = 1; ; ticks++) {
      const tick = fightTick({
        tick: ticks,
        playerHp: health,
        enemyHp,
        player,
        enemy,
        rng: streams.combat,
        tickMs,
        playerAttacks: fleeingSince < 0,
      });
      health = Math.max(0, tick.playerHp);
      enemyHp = tick.enemyHp;
      if (tick.playerHit) playerHits += 1;
      if (tick.enemyHit) enemyHits += 1;
      const result = (outcome: FightResult['outcome']): FightResult => ({ outcome, ticks, health, playerHits, enemyHits, drunk, queue: fightQueue });
      if (tick.outcome === 'loss') return result('loss');
      if (tick.playerHit) health = Math.min(max, health + lifeStealHeal(tick.playerDamage, lifeSteal));
      health = Math.min(max, health + regenPerTick + deliver(fightQueue, tickMs));
      if (tick.outcome === 'win') return result('win');
      const itemId = chooseAutoPotion(health, max, pendingOf(fightQueue), held.filter((potion) => potion.qty > 0));
      const potion = held.find((p) => p.itemId === itemId);
      if (potion !== undefined) {
        potion.qty -= 1;
        drunk.push(potion.itemId);
        fightQueue.push({ itemId: potion.itemId, amount: potion.amount, durationMs: potion.durationSeconds * MS_PER_SECOND, remainingMs: potion.durationSeconds * MS_PER_SECOND });
      }
      if (fleeingSince < 0 && health < trigger) fleeingSince = ticks;
      if (fleeingSince >= 0 && ticks - fleeingSince >= fleeTicks) return result('fled');
    }
  };

  /** Time to heal to full in the city (3.2, decisions L10): potions up to the character's choice, then regeneration. */
  const cityHeal = (): { ms: number; drunk: string[] } => {
    const { max, perSecond } = vitals();
    const held = heldPotions(character, data);
    const target = cityPotionTarget(character.settings.cityHealing, constantSection(data, 'cityHealing').balancedFraction);
    const drunk: string[] = [];
    const flushMs = queue.reduce((sum, potion) => sum + potion.remainingMs, 0);
    let health = Math.min(max, character.health + pendingOf(queue) + (perSecond * flushMs) / MS_PER_SECOND);
    let ms = tickMs + flushMs;
    for (;;) {
      const itemId = chooseCityPotion(health, max, target, held.filter((potion) => potion.qty > 0));
      const potion = held.find((p) => p.itemId === itemId);
      if (potion === undefined) break;
      potion.qty -= 1;
      drunk.push(potion.itemId);
      health = Math.min(max, health + potion.amount + perSecond * potion.durationSeconds);
      ms += potion.durationSeconds * MS_PER_SECOND;
    }
    if (health < max) ms += quantiseToSteps(((max - health) / perSecond) * MS_PER_SECOND, tickMs);
    return { ms, drunk };
  };

  /** Reward and return checks after a kill (engine/character.ts `checkReturnTriggers`, looting phase). */
  const afterKill = (enemyId: string): Leg => {
    ctx.emit({ type: 'enemyKilled', characterId: character.id, enemyId });
    absorbOnEnemyKill(character, enemyId, ctx);
    const levelAtKill = character.level;
    grantKillXp(character, enemyId, ctx);
    grantKillLoot(character, enemyId, ctx, levelAtKill);
    if (character.health < character.settings.returnHealthThreshold * vitals().max) return 'back';
    if (!isBagFull(character, data)) {
      character.blockBagFullReturn = false;
      return 'field';
    }
    return character.blockBagFullReturn ? 'field' : 'back';
  };

  /** Arrival in the city: sell and restock by the live code, then heal or leave. */
  const arrive = (): Leg => {
    arriveInCity(character, ctx);
    return character.phase === 'restocking' ? 'heal' : 'out';
  };

  /** One search and one fight. Returns where the character goes next, or null when the time is up first. */
  const fieldStep = (): Leg | null => {
    const searchMs = searchDurationMs(character, ctx);
    if (elapsed + searchMs > budgetMs) return null;
    walk(searchMs);
    const enemyId = character.targetEnemyId ?? rollSpawn(area, streams.search);
    const combatBefore = streams.combat.getState();
    const fight = runFight(enemyId);
    const fightMs = fight.ticks * tickMs;
    if (elapsed + fightMs > budgetMs) {
      unfinished = { combat: combatBefore }; // the fight is discarded, so are its draws (saved as the stream state)
      return null;
    }
    elapsed += fightMs;
    character.health = fight.health;
    queue = fight.queue;
    for (const itemId of fight.drunk) takeFromBag(character, itemId);
    const enemyLevel = (requireRow(data, 'enemies', enemyId) as unknown as { level: number }).level;
    train(trainedWeaponSkill(character, data), enemyLevel, fight.playerHits);
    train('combat', enemyLevel, fight.playerHits);
    train('toughness', enemyLevel, fight.enemyHits);
    if (fight.outcome === 'win') return afterKill(enemyId);
    if (fight.outcome === 'fled') return 'back';
    ctx.emit({ type: 'characterDied', characterId: character.id, enemyId });
    queue = [];
    loseXpOnDeath(character, ctx);
    elapsed += respawnDurationMs(character, ctx);
    if (elapsed > budgetMs) return 'dead';
    character.health = respawnHealth(vitals().max, constantSection(data, 'death'));
    return arrive();
  };

  const potionTiers = constantSection(data, 'potions').tiers;
  const potionTickMs = constantSection(data, 'potions').tickMs;
  let queue: DrinkingPotion[] = character.potions.queue.flatMap((itemId, i) => {
    const tierId = (requireRow(data, 'items', itemId) as unknown as PotionItemRow).effect?.tier;
    const tier = potionTiers.find((t: PotionTier) => t.id === tierId);
    if (tier === undefined) return [];
    const durationMs = tier.durationSeconds * MS_PER_SECOND;
    return { itemId, amount: tier.amount, durationMs, remainingMs: durationMs - (i === 0 ? character.potions.ticksDone * potionTickMs : 0) };
  });

  let leg: Leg = character.phase === 'restocking' ? 'heal' : character.phase === 'returning' ? 'back' : 'out';
  if (character.phase === 'dead') {
    // As stepDead: wait out the rest of the respawn timer, then arrive in the city (sell, restock) at respawn health.
    elapsed = Math.max(0, respawnDurationMs(character, ctx) - character.timeInPhaseMs);
    if (elapsed > budgetMs) leg = 'dead';
    else {
      character.health = respawnHealth(vitals().max, constantSection(data, 'death'));
      leg = arrive();
    }
  }
  while (leg !== 'dead') {
    let next: Leg | null;
    if (leg === 'field') next = fieldStep();
    else if (leg === 'heal') {
      const heal = cityHeal();
      next = elapsed + heal.ms > budgetMs ? null : 'out';
      if (next !== null) {
        elapsed += heal.ms;
        queue = [];
        for (const itemId of heal.drunk) takeFromBag(character, itemId);
        character.health = vitals().max;
        character.blockBagFullReturn = isBagFull(character, data);
      }
    } else {
      const ms = travelDurationMs(character, ctx);
      next = elapsed + ms > budgetMs ? null : (walk(ms), leg === 'back' ? arrive() : 'field');
    }
    if (next === null) break;
    leg = next;
  }

  const head = queue[0];
  character.potions = {
    queue: queue.map((potion) => potion.itemId),
    ticksDone: head === undefined ? 0 : Math.round((head.durationMs - head.remainingMs) / potionTickMs),
    msIntoTick: 0,
  };
  character.phase = PHASE_OF_LEG[leg];
  character.timeInPhaseMs = 0;
  character.fight = null;
  character.rng = { ...readStreamStates(streams), ...unfinished };
  summary.gold = character.gold - goldAtStart;
  return summary;
}

/**
 * The offline estimator (ADR 0002 "Offline estimator", issue 29). Walks every character through its trips for
 * `seconds` x `offline.efficiency` of farming time and applies the result to `state`. Proficiency grows at
 * `offline.proficiencyRate`. A death takes the 3.7 penalty from the live code and is counted in `deaths`.
 * The summary's `gold` is the net change in the character's gold (kills, sales and restocking); `items` are the
 * drops picked up, whether or not they were sold afterwards.
 */
export const estimateOffline: EstimateOffline = (state, seconds, data) => {
  const budgetMs = seconds * requireNumberConstant(data, 'offline.efficiency') * MS_PER_SECOND;
  const proficiencyRate = requireNumberConstant(data, 'offline.proficiencyRate');
  return {
    characters: [...state.roster]
      .sort(compareCharacterIds)
      .map((character) => estimateCharacter(state, character, budgetMs, proficiencyRate, data)),
  };
};

function addItems(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const total = { ...a };
  for (const [itemId, quantity] of Object.entries(b)) total[itemId] = (total[itemId] ?? 0) + quantity;
  return total;
}

/**
 * Adds a new offline summary to one the player has not seen yet (ADR 0003 "pendingSummary"), so a second
 * absence on top of an unseen Welcome back screen loses nothing. Per character, in id order.
 */
export function mergeSummaries(pending: OfflineSummary | null, next: OfflineSummary): OfflineSummary {
  if (pending === null) return next;
  const byId = new Map<string, CharacterSummary>();
  for (const summary of [...pending.characters, ...next.characters]) {
    const earlier = byId.get(summary.characterId);
    const deaths = (earlier?.deaths ?? 0) + (summary.deaths ?? 0);
    byId.set(
      summary.characterId,
      earlier
        ? {
            characterId: summary.characterId,
            kills: earlier.kills + summary.kills,
            xp: earlier.xp + summary.xp,
            gold: earlier.gold + summary.gold,
            items: addItems(earlier.items, summary.items),
            ...(deaths > 0 && { deaths }),
          }
        : { ...summary, items: { ...summary.items } },
    );
  }
  return {
    seconds: pending.seconds + next.seconds,
    discardedSeconds: pending.discardedSeconds + next.discardedSeconds,
    characters: [...byId.values()].sort((a, b) => compareCharacterIds({ id: a.characterId }, { id: b.characterId })),
  };
}
