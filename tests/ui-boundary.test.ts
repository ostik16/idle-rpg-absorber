import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// ADR 0001 and architecture "Dependency direction": `ui` imports engine types only, and the components reach the game
// through the store. The repo has no linter, so this test is that rule, like tests/purity.test.ts.
const sources = import.meta.glob('../src/ui/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

interface ModuleReference {
  from: string;
  typeOnly: boolean;
}

const COMPUTED = '<computed>';

function importIsTypeOnly(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const named = clause.namedBindings;
  if (clause.name || !named || !ts.isNamedImports(named) || named.elements.length === 0) return false;
  return named.elements.every((element) => element.isTypeOnly);
}

function exportIsTypeOnly(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const named = node.exportClause;
  return !!named && ts.isNamedExports(named) && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly);
}

/** Every module a source reaches, in any form. Parsed, not matched, so comments and strings do not count. */
function moduleReferences(source: string): ModuleReference[] {
  const file = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const found: ModuleReference[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      found.push({ from: node.moduleSpecifier.text, typeOnly: importIsTypeOnly(node) });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      found.push({ from: node.moduleSpecifier.text, typeOnly: exportIsTypeOnly(node) });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [target] = node.arguments;
      found.push({ from: target && ts.isStringLiteralLike(target) ? target.text : COMPUTED, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function reaches(reference: ModuleReference, layer: string): boolean {
  return reference.from === COMPUTED || new RegExp(`(^|/)${layer}(/|$)`).test(reference.from);
}

describe('moduleReferences', () => {
  it.each([
    [`import { createEngine } from '../engine/engine';`, false],
    [`import { createEngine } from "../engine/engine";`, false],
    [`import '../engine/engine';`, false],
    [`import * as engine from '../engine/engine';`, false],
    [`import engine, { type Engine } from '../engine/engine';`, false],
    [`import { type Engine, createEngine } from '../engine/engine';`, false],
    [`export { createEngine } from '../engine/engine';`, false],
    [`export * from "../engine/engine";`, false],
    [`const load = () => import('../engine/engine');`, false],
    [`import type { Engine } from '../engine/engine';`, true],
    [`import { type Engine } from '../engine/engine';`, true],
    [`export type { Engine } from '../engine/engine';`, true],
  ])('reads %s', (source, typeOnly) => {
    expect(moduleReferences(source)).toEqual([{ from: '../engine/engine', typeOnly }]);
  });

  it('flags a dynamic import it cannot read, and skips comments and strings', () => {
    expect(moduleReferences(`const go = (path: string) => import(path);`)).toEqual([{ from: COMPUTED, typeOnly: false }]);
    expect(moduleReferences(`// import x from '../engine/engine';\nconst s = "import '../engine/engine'";`)).toEqual([]);
  });
});

describe('UI boundary', () => {
  it('finds the UI sources', () => {
    expect(Object.keys(sources).some((path) => path.endsWith('/store.ts'))).toBe(true);
  });

  it.each(Object.entries(sources))('%s imports only types from the engine', (_path, source) => {
    const fromEngine = moduleReferences(source).filter((reference) => reaches(reference, 'engine'));
    expect(fromEngine.filter(({ typeOnly }) => !typeOnly)).toEqual([]);
  });

  it.each(Object.entries(sources).filter(([path]) => !path.endsWith('/store.ts') && !path.endsWith('/frame-loop.ts')))(
    '%s never touches the engine or state directly',
    (_path, source) => {
      expect(source).not.toMatch(/\bengine\b\s*\.|\.state\b|\.roster\b(?!\.value)/);
      const direct = moduleReferences(source).filter((r) => reaches(r, 'state') || reaches(r, 'engine'));
      expect(direct).toEqual([]);
    },
  );
});
