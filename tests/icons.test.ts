import { describe, expect, it } from 'vitest';
import { iconBodies, svgBody, type IconName } from '../src/ui/icons';

const names = Object.keys(iconBodies) as IconName[];

describe('icon table', () => {
  it('has the concepts from the design system README', () => {
    // The 21 concepts in the README's "One icon per concept" list.
    const concepts: IconName[] = [
      'roster', 'world', 'city', 'bestiary', 'farming', 'travelling', 'inCity', 'dead', 'gold', 'absorption', 'rareItem',
      'potion', 'upgrade', 'warehouse', 'teleporter', 'shop', 'lootFilter', 'returnToCity', 'targetEnemy', 'locked', 'bag',
    ];
    expect(names).toEqual(expect.arrayContaining(concepts));
  });

  it.each(names)('%s resolves to SVG shapes', (name) => {
    const body = iconBodies[name];
    expect(body.length).toBeGreaterThan(0);
    expect(body).toMatch(/<(path|circle|rect|line|polyline|polygon|ellipse)\b/);
  });

  it.each(names)('%s leaves size and stroke to the ab-icon class', (name) => {
    const body = iconBodies[name];
    expect(body).not.toContain('<svg');
    expect(body).not.toContain('<!--');
    expect(body).not.toMatch(/stroke-width/);
  });
});

describe('svgBody', () => {
  it('keeps only what is inside the svg tag', () => {
    const raw = '<!-- @license -->\n<svg\n  stroke-width="2"\n>\n  <path d="M0 0" />\n</svg>';
    expect(svgBody(raw)).toBe('<path d="M0 0" />');
  });

  it('returns an empty string when there is no svg', () => {
    expect(svgBody('not an icon')).toBe('');
  });
});
