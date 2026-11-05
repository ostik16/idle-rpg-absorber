import { Icon } from './Icon';
import { itemInfo } from './store';

/** The slot's stack, as the store publishes it. Declared here so components need no import from `state/`. */
export interface SlotStack {
  readonly itemId: string;
  readonly upgradeLevel: number;
  readonly qty: number;
}

/** Upgrade marks: +1 to +3 plain, +4 to +6 gold, +7 to +9 arcane (design system, ItemSlot). */
function plusClass(level: number): string {
  return level >= 7 ? ' ab-slot__plus--arcane' : level >= 4 ? ' ab-slot__plus--gold' : '';
}

/** One cell. `null` is an empty cell. A filled cell is a button when it has `onClick`, and spans as many cells as the item is big. */
export function ItemSlot({ stack, selected, onClick }: { stack: SlotStack | null; selected?: boolean; onClick?: () => void }) {
  if (stack === null) return <span class="ab-slot ab-slot--empty" aria-hidden="true" />;
  const info = itemInfo(stack.itemId);
  const label = `${info.name}${stack.upgradeLevel > 0 ? ` +${stack.upgradeLevel}` : ''}${stack.qty > 1 ? `, ×${stack.qty}` : ''}`;
  const span = info.size === 2 || info.size === 3 ? ` ab-slot--h${info.size}` : '';
  return (
    <button
      type="button"
      class={`ab-slot${span}${info.category === 'rare' ? ' ab-slot--rare' : ''}${selected === true ? ' ab-slot--selected' : ''}`}
      aria-label={label}
      aria-pressed={selected}
      onClick={onClick}
    >
      <Icon name={info.icon} />
      {stack.upgradeLevel > 0 && <span class={`ab-slot__plus${plusClass(stack.upgradeLevel)}`}>+{stack.upgradeLevel}</span>}
      {stack.qty > 1 && <span class="ab-slot__count">{stack.qty}</span>}
    </button>
  );
}

/** The one grid for the bag, the warehouse tab and the sell list. Stacks in the order held, then empty cells up to `capacity`. */
export function BagGrid({
  stacks,
  capacity,
  used,
  selected,
  onToggle,
  label,
}: {
  stacks: readonly SlotStack[];
  /** Total cells, to draw the free ones. Omit to draw only the stacks. */
  capacity?: number;
  /** Cells the stacks use (a weapon takes 3). */
  used?: number;
  selected?: ReadonlySet<number>;
  onToggle?: (index: number) => void;
  label: string;
}) {
  const free = capacity === undefined || used === undefined ? 0 : Math.max(0, capacity - used);
  return (
    <div class="ab-grid app__grid" role="group" aria-label={label}>
      {stacks.map((stack, i) => (
        <ItemSlot key={i} stack={stack} selected={selected === undefined ? undefined : selected.has(i)} onClick={onToggle === undefined ? undefined : () => onToggle(i)} />
      ))}
      {Array.from({ length: free }, (_, i) => <ItemSlot key={`free-${i}`} stack={null} />)}
    </div>
  );
}
