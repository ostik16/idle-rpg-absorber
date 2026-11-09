import { requireNumberConstant } from './data/game-data';
import { openSaves, saveFailureNotice, saveNotices, startAutosave, type Saves } from './save';
import type { StorageApis } from './save/store';
import type { SaveSeam } from './start-game';
import { createGameState } from './state/factory';
import { showLastingNotices } from './ui/store';

// shortcut: 'unrecoverable' blocks the game with the notice lines. The recovery screen (import a file or start
// fresh, ADR 0003) comes with #36's import; until then a player with only corrupt saves has to wait for that.
export function createSaveSeam(appBuild: string, apis?: StorageApis): SaveSeam {
  let saves: Saves | undefined;
  return {
    async open(data, nowMs) {
      saves = await openSaves({
        appBuild,
        tables: data,
        leaseWaitMs: requireNumberConstant(data, 'save.leaseWaitSeconds') * 1000,
        ...(apis && { apis }),
      });
      const result = await saves.load();
      const notices = saveNotices(result, saves.storage);
      if (result.status === 'loaded') return { status: 'play', state: result.state, notices };
      if (result.status === 'empty') {
        const [masterSeed = 0] = crypto.getRandomValues(new Uint32Array(1));
        return { status: 'play', state: createGameState(masterSeed, nowMs, data), notices };
      }
      return { status: 'blocked', lines: notices };
    },
    startAutosave({ data, getState }) {
      if (!saves) throw new Error('startAutosave before open');
      return startAutosave({
        saves,
        getState,
        intervalMs: requireNumberConstant(data, 'save.autosaveSeconds') * 1000,
        onError: (error) => showLastingNotices([saveFailureNotice(error)]),
      });
    },
  };
}
