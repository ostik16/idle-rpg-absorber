import { constantSection } from '../data/game-data';
import { Stepper } from './Stepper';
import { requireGameData, ruleCategories, type ItemRule, type ItemRuleSet } from './store';

const MIN_LEVEL = 1;

/** The category rows' state, read from a rule set: which are ticked and the equipment minimum level. */
function readRules(rules: readonly ItemRule[]) {
  const ticked = new Set(rules.flatMap((rule) => (rule.category === undefined ? [] : [rule.category])));
  const level = rules.find((rule) => rule.category === 'equipment')?.minRequiredLevel ?? MIN_LEVEL;
  return { ticked, level };
}

/**
 * The rule set for these ticks, in display order. Rules the editor has no row for (a bonus-attribute rule, later)
 * ride along untouched, so editing a category never drops them.
 */
function buildRules(old: readonly ItemRule[], ticked: ReadonlySet<string>, level: number): ItemRule[] {
  const known = ruleCategories();
  const rules = known.filter((c) => ticked.has(c.id)).map((c): ItemRule => (c.hasMinLevel ? { category: c.id, minRequiredLevel: level } : { category: c.id }));
  return [...rules, ...old.filter((rule) => !known.some((c) => c.id === rule.category))];
}

function sentence(parts: readonly string[]): string {
  if (parts.length === 0) return 'Nothing.';
  const text = parts.length === 1 ? (parts[0] as string) : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/**
 * The one editor for the loot filter and the auto-sell list (design 2.3). The switch is `ruleSet.enabled`; the Loot
 * filter sketch has no such control, see decisions R12. While it is off the ticks stay saved but do nothing.
 */
export function RuleEditor({
  title,
  summaryVerb,
  offMeaning,
  ruleSet,
  characterName,
  onChange,
}: {
  title: string;
  summaryVerb: string;
  offMeaning: string;
  ruleSet: ItemRuleSet;
  characterName: string;
  onChange: (next: ItemRuleSet) => void;
}) {
  const { ticked, level } = readRules(ruleSet.rules);
  const categories = ruleCategories();
  const levelCap = constantSection(requireGameData(), 'levelCap');
  const id = title.toLowerCase().replace(/\s+/g, '-');
  const set = (nextTicked: ReadonlySet<string>, nextLevel: number) =>
    onChange({ enabled: ruleSet.enabled, rules: buildRules(ruleSet.rules, nextTicked, nextLevel) });
  const toggle = (category: string) => {
    const next = new Set(ticked);
    if (!next.delete(category)) next.add(category);
    set(next, level);
  };
  const summary = ruleSet.enabled
    ? sentence(categories.filter((c) => ticked.has(c.id)).map((c) => (c.hasMinLevel ? `${c.label.toLowerCase()} Lv ${level}+` : c.label.toLowerCase())))
    : offMeaning;

  return (
    <section class="ab-card app__stack" aria-labelledby={`${id}-h`}>
      <div class="app__field-head">
        <h2 id={`${id}-h`} class="ab-label app__grow">{title}</h2>
        <button
          type="button"
          role="switch"
          class="ab-switch"
          aria-checked={ruleSet.enabled}
          aria-label={title}
          onClick={() => onChange({ enabled: !ruleSet.enabled, rules: ruleSet.rules })}
        />
      </div>
      <div class="app__stack">
        <span class="app__field-help ab-c-muted">{characterName} {summaryVerb}</span>
        <p class="ab-title" aria-live="polite">{summary}</p>
      </div>
      <div class="app__targets">
        {categories.map((category) => {
          const on = ticked.has(category.id);
          return (
            <div key={category.id} class="app__stack">
              <label class="app__target">
                <input type="checkbox" checked={on} disabled={!ruleSet.enabled} onChange={() => toggle(category.id)} />
                <span class="app__target-body">
                  <span class={ruleSet.enabled ? 'ab-num' : 'ab-num ab-c-muted'}>{category.label}</span>
                  <span class="app__field-help ab-c-muted">{category.sub}</span>
                </span>
              </label>
              {category.hasMinLevel && on && (
                <Stepper
                  label="equipment required level"
                  text={`Lv ${level}+`}
                  downDisabled={!ruleSet.enabled || level <= MIN_LEVEL}
                  upDisabled={!ruleSet.enabled || level >= levelCap}
                  onDown={() => set(ticked, Math.max(MIN_LEVEL, level - 1))}
                  onUp={() => set(ticked, Math.min(levelCap, level + 1))}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
