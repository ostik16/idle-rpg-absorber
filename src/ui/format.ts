// Formatting shared by roster, app bar and character creation. Fixed formats from the design system README.
import type { IconName } from './icons';
import type { Phase } from './store';

/** Gold with thousands separators (`48,210`), the design system's fixed format. */
export function formatGold(n: number): string {
  return n.toLocaleString('en-US');
}

/** The icon and word that stand in for a character's phase (design system README, Colour table). */
export interface PhaseDescriptor {
  readonly icon: IconName;
  readonly label: string;
  /** The `ab-status` modifier that paints the colour (farming, travel, city, dead). */
  readonly modifier: 'farming' | 'travel' | 'city' | 'dead';
}

export function phaseDescriptor(phase: Phase): PhaseDescriptor {
  switch (phase) {
    case 'searching':
    case 'fighting':
    case 'looting':
      return { icon: 'farming', label: 'Farming', modifier: 'farming' };
    case 'travelling':
      return { icon: 'travelling', label: 'Travelling', modifier: 'travel' };
    case 'fleeing':
      return { icon: 'travelling', label: 'Fleeing', modifier: 'travel' };
    case 'returning':
      return { icon: 'travelling', label: 'Returning', modifier: 'travel' };
    case 'dead':
      return { icon: 'dead', label: 'Fell', modifier: 'dead' };
    case 'restocking':
    case 'idle':
      return { icon: 'inCity', label: 'In city', modifier: 'city' };
  }
}

/** True when a character can shop, change gear and use the warehouse (the engine's rule: idle or restocking). */
export function inCity(phase: Phase): boolean {
  return phase === 'idle' || phase === 'restocking';
}

/** The app bar's location line: where a character is, given its phase and the area it farms or walks to. */
export function locationLabel(phase: Phase, areaName: string | null): string {
  switch (phase) {
    case 'searching':
    case 'fighting':
    case 'looting':
      return areaName === null ? 'Farming' : `Farming ${areaName}`;
    case 'travelling':
      return areaName === null ? 'Travelling' : `Travelling to ${areaName}`;
    case 'fleeing':
    case 'returning':
      return 'Returning to the city';
    case 'dead':
    case 'restocking':
    case 'idle':
      return 'City';
  }
}
