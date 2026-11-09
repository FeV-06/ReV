import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  extractSymbols,
  diffSymbols,
  analyzeGitSymbols,
  type SymbolInfo,
  type ChangedSymbolInfo,
} from '../src/lib/server/symbols';

describe('Tree-sitter and AST symbol extraction', () => {
  it('extracts TypeScript functions, classes, interfaces, and types', async () => {
    const tsCode = `
export interface DatabaseConfig {
  host: string;
  port: number;
}

export type ConnectionStatus = 'connected' | 'disconnected';

export class ConnectionPool {
  connect(): boolean {
    return true;
  }
}

export function queryDatabase(sql: string): any[] {
  return [];
}

export const executeTx = async (txId: string) => {
  return true;
};
`;

    const report = await extractSymbols(tsCode, 'src/db.ts');
    expect(report.language).toBe('typescript');
    expect(report.filePath).toBe('src/db.ts');

    const names = report.symbols.map((s: SymbolInfo) => s.name);
    expect(names).toContain('DatabaseConfig');
    expect(names).toContain('ConnectionStatus');
    expect(names).toContain('ConnectionPool');
    expect(names).toContain('connect');
    expect(names).toContain('queryDatabase');
    expect(names).toContain('executeTx');

    const iface = report.symbols.find((s: SymbolInfo) => s.name === 'DatabaseConfig');
    expect(iface?.kind).toBe('interface');

    const fn = report.symbols.find((s: SymbolInfo) => s.name === 'queryDatabase');
    expect(fn?.kind).toBe('function');
    expect(fn?.startLine).toBeGreaterThan(0);
    expect(fn?.endLine).toBeGreaterThanOrEqual(fn!.startLine);
  });

  it('extracts Rust structs, enums, traits, functions, and modules', async () => {
    const rsCode = `
pub mod engine;

pub struct TaskRunner {
    pub id: u64,
}

pub enum Priority {
    Low,
    High,
}

pub trait Runner {
    fn execute(&self);
}

pub fn spawn_worker(runner: TaskRunner) -> bool {
    true
}
`;

    const report = await extractSymbols(rsCode, 'src/worker.rs');
    expect(report.language).toBe('rust');

    const names = report.symbols.map((s: SymbolInfo) => s.name);
    expect(names).toContain('engine');
    expect(names).toContain('TaskRunner');
    expect(names).toContain('Priority');
    expect(names).toContain('Runner');
    expect(names).toContain('spawn_worker');

    const structSym = report.symbols.find((s: SymbolInfo) => s.name === 'TaskRunner');
    expect(structSym?.kind).toBe('struct');
  });

  it('falls back gracefully on Python and unsupported languages', async () => {
    const pyCode = `
class CacheManager:
    def get(self, key):
        return None

def clear_cache():
    pass
`;

    const pyReport = await extractSymbols(pyCode, 'scripts/cache.py');
    expect(pyReport.language).toBe('python');
    const pyNames = pyReport.symbols.map((s: SymbolInfo) => s.name);
    expect(pyNames).toContain('CacheManager');
    expect(pyNames).toContain('clear_cache');

    const unknownReport = await extractSymbols('plain text without code', 'notes.txt');
    expect(unknownReport.language).toBe('unknown');
    expect(unknownReport.symbols).toEqual([]);
  });
});

describe('Diff symbol mapping and intersection logic', () => {
  it('maps diff hunks to modified and newly added symbols', async () => {
    const source = `export function calculateFee(amount: number): number {
  const base = 5;
  return amount + base;
}

export function auditTransaction(id: string): boolean {
  return true;
}
`;

    const patch = `@@ -2,2 +2,3 @@
-  const base = 5;
+  const base = 10;
+  const tax = 2;
   return amount + base;
`;

    const report = await diffSymbols(source, patch, 'src/billing.ts');
    expect(report.totalSymbols).toBe(2);
    expect(report.changedSymbols.length).toBe(1);

    const changed = report.changedSymbols[0];
    expect(changed.symbol.name).toBe('calculateFee');
    expect(changed.changeKind).toBe('modified');
    expect(changed.filePath).toBe('src/billing.ts');
  });

  it('ignores diffs in comments or whitespace that do not touch symbols', async () => {
    const source = `// Header comment
// Revision notes

export function untouched(): void {}
`;

    const patch = `@@ -1,2 +1,3 @@
 // Header comment
+// Extra note line
 // Revision notes
`;

    const report = await diffSymbols(source, patch, 'src/unmodified.ts');
    expect(report.changedSymbols.length).toBe(0);
  });
});

describe('Git commit symbols analysis', () => {
  it('analyzes real git commits and maps changed symbols to author metadata', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'rev-git-symbols-test-'));

    try {
      execFileSync('git', ['init', '-q', tempDir]);

      // Commit 1: baseline
      const mathPath = path.join(tempDir, 'math.ts');
      await writeFile(
        mathPath,
        `export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}
`
      );
      execFileSync('git', ['-C', tempDir, 'add', '.']);
      execFileSync(
        'git',
        ['-C', tempDir, '-c', 'user.name=FeV-06', '-c', 'user.email=fev@example.invalid', 'commit', '-qm', 'initial math']
      );

      // Commit 2: modify add and add subtract
      await writeFile(
        mathPath,
        `export function add(a: number, b: number): number {
  const result = a + b;
  return result;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}
`
      );
      execFileSync('git', ['-C', tempDir, 'add', '.']);
      execFileSync(
        'git',
        ['-C', tempDir, '-c', 'user.name=FeV-06', '-c', 'user.email=fev@example.invalid', 'commit', '-qm', 'feat: update add and add subtract']
      );
      const commit2Sha = execFileSync('git', ['-C', tempDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

      const report = await analyzeGitSymbols(tempDir, commit2Sha);

      expect(report.commitSha).toBe(commit2Sha);
      expect(report.authorName).toBe('FeV-06');
      expect(report.authorEmail).toBe('fev@example.invalid');
      expect(report.message).toBe('feat: update add and add subtract');

      expect(report.files.length).toBe(1);
      const file = report.files[0];
      expect(file.filePath).toBe('math.ts');
      expect(file.language).toBe('typescript');

      const changedNames = file.changedSymbols.map((c: ChangedSymbolInfo) => c.symbol.name);
      expect(changedNames).toContain('add');
      expect(changedNames).toContain('subtract');
      expect(changedNames).not.toContain('multiply');

      const addChange = file.changedSymbols.find((c: ChangedSymbolInfo) => c.symbol.name === 'add');
      expect(addChange?.changeKind).toBe('modified');

      const subChange = file.changedSymbols.find((c: ChangedSymbolInfo) => c.symbol.name === 'subtract');
      expect(subChange?.changeKind).toBe('added');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
