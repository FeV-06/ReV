import { callCore } from './core';

export type SymbolKind =
  | 'function'
  | 'method'
  | 'struct'
  | 'enum'
  | 'interface'
  | 'type_alias'
  | 'class'
  | 'module'
  | 'unknown';

export type ChangeKind = 'added' | 'modified' | 'deleted';

export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  signature?: string;
}

export interface ChangedSymbolInfo {
  symbol: SymbolInfo;
  filePath: string;
  changeKind: ChangeKind;
}

export interface FileSymbolsReport {
  filePath: string;
  language: string;
  symbols: SymbolInfo[];
}

export interface DiffSymbolsReport {
  filePath: string;
  language: string;
  totalSymbols: number;
  changedSymbols: ChangedSymbolInfo[];
}

export interface CommitSymbolsReport {
  commitSha: string;
  authorName: string;
  authorEmail: string;
  message: string;
  files: DiffSymbolsReport[];
}

export async function extractSymbols(source: string, filePath: string): Promise<FileSymbolsReport> {
  return (await callCore({
    op: 'extract_symbols',
    source,
    filePath,
  })) as FileSymbolsReport;
}

export async function diffSymbols(source: string, patch: string, filePath: string): Promise<DiffSymbolsReport> {
  return (await callCore({
    op: 'diff_symbols',
    source,
    patch,
    filePath,
  })) as DiffSymbolsReport;
}

export async function analyzeGitSymbols(repoPath: string, commitSha: string): Promise<CommitSymbolsReport> {
  return (await callCore({
    op: 'analyze_git_symbols',
    repoPath,
    commitSha,
  })) as CommitSymbolsReport;
}
