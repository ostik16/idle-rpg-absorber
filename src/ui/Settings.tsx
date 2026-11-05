import { constantSection } from '../data/game-data';
import { Icon } from './Icon';
import { RuleEditor } from './RuleEditor';
import { Stepper } from './Stepper';
import {
  requireGameData,
  restockablePotions,
  roster,
  send,
  settingsCharacterId,
  type CharacterView,
  type CityHealingMode,
  type ItemInfo,
} from './store';

const RETURN_STEP = 5;
const RETURN_MIN = 10;
const RETURN_MAX = 90;
const DRINK_MIN = 5;
const DRINK_MAX = 95;
const RESTOCK_MAX = 99;
const MODES: readonly CityHealingMode[] = ['fast', 'balanced', 'slow'];
const MODE_LABEL: Record<CityHealingMode, string> = { fast: 'Fast', balanced: 'Balanced', slow: 'Slow' };

const percent = (fraction: number): number => Math.round(fraction * 100);
const SAVE = { saveAfter: true } as const;

function ReturnThreshold({ view }: { view: CharacterView }) {
  const now = percent(view.returnHealthThreshold.value);
  const set = (next: number) => send({ type: 'setReturnHealthThreshold', characterId: view.id, threshold: next / 100 }, SAVE);
  return (
    <section class="ab-card app__stack" aria-labelledby="return-h">
      <h2 id="return-h" class="ab-label">Return to city</h2>
      <div class="app__field-head">
        <p class="app__field-help ab-c-muted app__grow">Heads back when health drops below {now}%.</p>
        <Stepper
          label="return threshold"
          text={`${now}%`}
          downDisabled={now <= RETURN_MIN}
          upDisabled={now >= RETURN_MAX}
          onDown={() => set(Math.max(RETURN_MIN, now - RETURN_STEP))}
          onUp={() => set(Math.min(RETURN_MAX, now + RETURN_STEP))}
        />
      </div>
    </section>
  );
}

function CityHealing({ view }: { view: CharacterView }) {
  const mode = view.cityHealing.value;
  const balanced = percent(constantSection(requireGameData(), 'cityHealing').balancedFraction);
  const help: Record<CityHealingMode, string> = {
    fast: 'Potions whenever available',
    balanced: `Potions down to ${balanced}%, then regeneration`,
    slow: 'Regeneration only',
  };
  return (
    <section class="ab-card app__stack" aria-labelledby="healing-h">
      <h2 id="healing-h" class="ab-label">City healing</h2>
      <div class="ab-seg" role="tablist" aria-label="City healing">
        {MODES.map((m) => (
          <button key={m} type="button" role="tab" class="ab-seg__item" aria-selected={mode === m} onClick={() => send({ type: 'setCityHealing', characterId: view.id, mode: m }, SAVE)}>
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <p class="app__field-help ab-c-muted">{help[mode]}</p>
    </section>
  );
}

function PotionRow({ view, potion }: { view: CharacterView; potion: ItemInfo }) {
  const quantity = view.restockList.value.find((entry) => entry.itemId === potion.id)?.quantity ?? 0;
  const override = view.potionThresholds.value[potion.id];
  const drinkAt = potion.autoUseDefaultThreshold === null ? null : percent(override ?? potion.autoUseDefaultThreshold);
  // Keep the saved order and add the potion at the end when it is new, so changing one row never reorders buying.
  const setQuantity = (next: number) => {
    const list = view.restockList.value;
    const has = list.some((entry) => entry.itemId === potion.id);
    const updated = has ? list.map((entry) => (entry.itemId === potion.id ? { ...entry, quantity: next } : entry)) : [...list, { itemId: potion.id, quantity: next }];
    send({ type: 'setRestockList', characterId: view.id, list: updated.map(({ itemId, quantity: q }) => ({ itemId, quantity: q })) }, SAVE);
  };
  const setDrinkAt = (next: number | null) => send({ type: 'setPotionThreshold', characterId: view.id, itemId: potion.id, threshold: next === null ? null : next / 100 }, SAVE);
  return (
    <div class="app__stack">
      <div class="app__field-head">
        <span class="ab-slot" aria-hidden="true"><Icon name={potion.icon} /></span>
        <span class="ab-num app__grow">{potion.name}</span>
      </div>
      <div class="app__field-head">
        <span class="app__field-help ab-c-muted app__grow">Restock to</span>
        <Stepper label={`${potion.name} restock`} text={String(quantity)} downDisabled={quantity <= 0} upDisabled={quantity >= RESTOCK_MAX} onDown={() => setQuantity(quantity - 1)} onUp={() => setQuantity(quantity + 1)} />
      </div>
      {drinkAt !== null && (
        <div class="app__field-head">
          <span class="app__field-help ab-c-muted app__grow">Drink at{override === undefined ? ' (default)' : ''}</span>
          <Stepper label={`${potion.name} drink-at`} text={`${drinkAt}%`} downDisabled={drinkAt <= DRINK_MIN} upDisabled={drinkAt >= DRINK_MAX} onDown={() => setDrinkAt(Math.max(DRINK_MIN, drinkAt - RETURN_STEP))} onUp={() => setDrinkAt(Math.min(DRINK_MAX, drinkAt + RETURN_STEP))} />
          {override !== undefined && <button type="button" class="ab-btn ab-btn--ghost ab-btn--sm" aria-label={`Use the default drink-at for ${potion.name}`} onClick={() => setDrinkAt(null)}>Default</button>}
        </div>
      )}
    </div>
  );
}

function Potions({ view }: { view: CharacterView }) {
  return (
    <section class="ab-card app__stack" aria-labelledby="potions-h">
      <h2 id="potions-h" class="ab-label">Potions</h2>
      <p class="app__field-help ab-c-muted">Restocked in the city before heading out. Drunk when health falls to the drink-at level.</p>
      {restockablePotions().map((potion) => <PotionRow key={potion.id} view={view} potion={potion} />)}
    </section>
  );
}

/** One character's settings (design 3.2, 2.3, 2.6). Every control sends its command straight away. */
export function Settings() {
  const view = roster.value.find((v) => v.id === settingsCharacterId.value);
  if (view === undefined) return null;
  return (
    <section class="app__stack">
      <ReturnThreshold view={view} />
      <CityHealing view={view} />
      <Potions view={view} />
      <RuleEditor
        title="Loot filter"
        summaryVerb="picks up"
        offMeaning="Picks up everything."
        ruleSet={view.lootFilter.value}
        characterName={view.name}
        onChange={(lootFilter) => send({ type: 'setLootFilter', characterId: view.id, lootFilter }, SAVE)}
      />
      <RuleEditor
        title="Auto-sell"
        summaryVerb="sells"
        offMeaning="Sells nothing."
        ruleSet={view.autoSell.value}
        characterName={view.name}
        onChange={(autoSell) => send({ type: 'setAutoSell', characterId: view.id, autoSell }, SAVE)}
      />
      <p class="app__field-help ab-c-muted">Settings are kept per character.</p>
    </section>
  );
}
