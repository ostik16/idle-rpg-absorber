// One icon per concept (design system README, Iconography). Per-icon imports keep unused icons out of the bundle.
import archive from 'lucide-static/icons/archive.svg?raw';
import backpack from 'lucide-static/icons/backpack.svg?raw';
import bookOpen from 'lucide-static/icons/book-open.svg?raw';
import castle from 'lucide-static/icons/castle.svg?raw';
import circleDot from 'lucide-static/icons/circle-dot.svg?raw';
import coins from 'lucide-static/icons/coins.svg?raw';
import crosshair from 'lucide-static/icons/crosshair.svg?raw';
import filter from 'lucide-static/icons/filter.svg?raw';
import flaskRound from 'lucide-static/icons/flask-round.svg?raw';
import footprints from 'lucide-static/icons/footprints.svg?raw';
import gem from 'lucide-static/icons/gem.svg?raw';
import hammer from 'lucide-static/icons/hammer.svg?raw';
import house from 'lucide-static/icons/house.svg?raw';
import lock from 'lucide-static/icons/lock.svg?raw';
import map from 'lucide-static/icons/map.svg?raw';
import orbit from 'lucide-static/icons/orbit.svg?raw';
import packageIcon from 'lucide-static/icons/package.svg?raw';
import scroll from 'lucide-static/icons/scroll.svg?raw';
import shield from 'lucide-static/icons/shield.svg?raw';
import skull from 'lucide-static/icons/skull.svg?raw';
import sparkle from 'lucide-static/icons/sparkle.svg?raw';
import store from 'lucide-static/icons/store.svg?raw';
import sword from 'lucide-static/icons/sword.svg?raw';
import swords from 'lucide-static/icons/swords.svg?raw';
import undo2 from 'lucide-static/icons/undo-2.svg?raw';
import users from 'lucide-static/icons/users.svg?raw';

const rawIcons = {
  roster: users,
  world: map,
  city: castle,
  bestiary: bookOpen,
  farming: swords,
  travelling: footprints,
  inCity: house,
  dead: skull,
  gold: coins,
  absorption: sparkle,
  rareItem: gem,
  potion: flaskRound,
  upgrade: hammer,
  warehouse: archive,
  teleporter: orbit,
  shop: store,
  lootFilter: filter,
  returnToCity: undo2,
  targetEnemy: crosshair,
  locked: lock,
  bag: backpack,
  categorySword: sword,
  categoryShield: shield,
  categoryFlask: flaskRound,
  categoryGem: gem,
  // Lucide has no ring (decisions L19).
  categoryRing: circleDot,
  categoryScroll: scroll,
  // The `icon` names used in data/items.json, so an item's icon string is a key (store `itemInfo`).
  sword,
  shield,
  gem,
  package: packageIcon,
  coins,
  hammer,
  'flask-round': flaskRound,
} as const;

export type IconName = keyof typeof rawIcons;

/**
 * The shapes inside a Lucide SVG, without the outer `<svg>` tag, so the `ab-icon` class on our own `<svg>`
 * sets size and stroke (stroke-width 1.75 in bundle.css). Also drops the licence comment.
 */
export function svgBody(raw: string): string {
  const match = /<svg\b[^>]*>([\s\S]*?)<\/svg>/.exec(raw);
  return (match?.[1] ?? '').trim();
}

export const iconBodies = Object.fromEntries(
  Object.entries(rawIcons).map(([name, raw]) => [name, svgBody(raw)]),
) as Record<IconName, string>;
