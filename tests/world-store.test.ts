import { describe, expect, it } from 'vitest';
import dropTables from '../data/drop-tables.json';
import { loadGameData } from '../src/data/game-data';
import type { EngineEvent } from '../src/engine/events';
import { respawnSeconds } from '../src/game/progression';
import { createCharacterState, createGameState } from '../src/state/factory';
import type { CharacterState } from '../src/state/types';
import { areaEnemies, connectEngine, listAreas, roster, type CharacterView } from '../src/ui/store';

const data = loadGameData();

function connect(events: EngineEvent[] = []) {
  const state = createGameState(7, 1_000_000, data);
  state.roster.push(createCharacterState('c1', 'Kaela', data));
  const refresh = connectEngine({ state, dispatch: () => {}, drainEvents: () => events.splice(0) }, data);
  return { state, refresh, character: state.roster[0] as CharacterState };
}

describe('world selectors', () => {
  it('lists areas from data', () => {
    connect();
    expect(listAreas().find((a) => a.id === 'mossfang-glade')).toMatchObject({
      levelMin: 1,
      levelMax: 5,
      distanceFromCity: 10,
    });
  });

  it('lists an area enemy with its targeting multiplier and top drop chance', () => {
    connect();
    const rat = areaEnemies('mossfang-glade').find((e) => e.id === 'glade-rat');
    const table = dropTables.find((t) => t.id === 'drop-glade-rat');
    expect(rat).toMatchObject({ level: 1, targetingMultiplier: 2 });
    expect(rat?.topDropChanceBase).toBe(Math.max(...(table?.entries.map((e) => e.baseChance) ?? [])));
    expect(rat?.traits[0]?.name).toBe('Life steal');
  });
});

describe('character view additions', () => {
  it('feeds loot newest first', () => {
    connect([
      { type: 'enemyKilled', characterId: 'c1', enemyId: 'glade-rat' },
      { type: 'xpGained', characterId: 'c1', amount: 9 },
    ]);
    expect((roster.value[0] as CharacterView).loot.value.map((l) => [l.text, l.amount])).toEqual([
      ['XP', '+9'],
      ['Glade rat slain', null],
    ]);
  });

  it('knows the respawn wait only while dead', () => {
    const { refresh, character } = connect();
    expect((roster.value[0] as CharacterView).phaseTotalMs.value).toBeNull();
    character.phase = 'dead';
    refresh();
    expect((roster.value[0] as CharacterView).phaseTotalMs.value).toBe(respawnSeconds(character.level) * 1000);
  });
});
