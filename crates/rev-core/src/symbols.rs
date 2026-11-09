use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use tree_sitter::{Language, Node, Parser};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SymbolKind {
    Function,
    Method,
    Struct,
    Enum,
    Interface,
    TypeAlias,
    Class,
    Module,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Symbol {
    pub name: String,
    pub kind: SymbolKind,
    pub start_line: usize, // 1-indexed
    pub end_line: usize,
    pub signature: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangedSymbol {
    pub symbol: Symbol,
    pub file_path: String,
    pub change_kind: ChangeKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSymbolsReport {
    pub file_path: String,
    pub language: String,
    pub symbols: Vec<Symbol>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSymbolsReport {
    pub file_path: String,
    pub language: String,
    pub total_symbols: usize,
    pub changed_symbols: Vec<ChangedSymbol>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SupportedLanguage {
    Rust,
    TypeScript,
    TSX,
    JavaScript,
    Python,
    Unknown,
}

impl SupportedLanguage {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Rust => "rust",
            Self::TypeScript => "typescript",
            Self::TSX => "tsx",
            Self::JavaScript => "javascript",
            Self::Python => "python",
            Self::Unknown => "unknown",
        }
    }
}

pub fn detect_language(file_path: &str) -> SupportedLanguage {
    let ext = Path::new(file_path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "rs" => SupportedLanguage::Rust,
        "ts" | "mts" | "cts" => SupportedLanguage::TypeScript,
        "tsx" => SupportedLanguage::TSX,
        "js" | "mjs" | "cjs" | "jsx" => SupportedLanguage::JavaScript,
        "py" | "pyw" => SupportedLanguage::Python,
        _ => SupportedLanguage::Unknown,
    }
}

fn get_node_text<'a>(node: &Node, source: &'a [u8]) -> &'a str {
    std::str::from_utf8(&source[node.start_byte()..node.end_byte()]).unwrap_or("")
}

fn get_signature(node: &Node, source: &[u8]) -> Option<String> {
    let text = get_node_text(node, source).trim();
    let first_line = text.lines().next().unwrap_or("").trim();
    if first_line.is_empty() {
        None
    } else {
        let sig = if first_line.ends_with('{') {
            first_line.trim_end_matches('{').trim()
        } else {
            first_line
        };
        Some(sig.to_string())
    }
}

fn extract_rust_symbols(source: &[u8]) -> Vec<Symbol> {
    let mut parser = Parser::new();
    let language: Language = tree_sitter_rust::LANGUAGE.into();
    if parser.set_language(&language).is_err() {
        return fallback_extract_symbols(source, SupportedLanguage::Rust);
    }

    let tree = match parser.parse(source, None) {
        Some(t) => t,
        None => return fallback_extract_symbols(source, SupportedLanguage::Rust),
    };

    let mut symbols = Vec::new();
    let root = tree.root_node();

    fn walk_rust(node: &Node, source: &[u8], symbols: &mut Vec<Symbol>) {
        let kind = node.kind();
        match kind {
            "function_item" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let name = get_node_text(&name_node, source).to_string();
                    let start_line = node.start_position().row + 1;
                    let end_line = node.end_position().row + 1;
                    symbols.push(Symbol {
                        name,
                        kind: SymbolKind::Function,
                        start_line,
                        end_line,
                        signature: get_signature(node, source),
                    });
                }
            }
            "struct_item" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    symbols.push(Symbol {
                        name: get_node_text(&name_node, source).to_string(),
                        kind: SymbolKind::Struct,
                        start_line: node.start_position().row + 1,
                        end_line: node.end_position().row + 1,
                        signature: get_signature(node, source),
                    });
                }
            }
            "enum_item" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    symbols.push(Symbol {
                        name: get_node_text(&name_node, source).to_string(),
                        kind: SymbolKind::Enum,
                        start_line: node.start_position().row + 1,
                        end_line: node.end_position().row + 1,
                        signature: get_signature(node, source),
                    });
                }
            }
            "mod_item" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    symbols.push(Symbol {
                        name: get_node_text(&name_node, source).to_string(),
                        kind: SymbolKind::Module,
                        start_line: node.start_position().row + 1,
                        end_line: node.end_position().row + 1,
                        signature: get_signature(node, source),
                    });
                }
            }
            "trait_item" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    symbols.push(Symbol {
                        name: get_node_text(&name_node, source).to_string(),
                        kind: SymbolKind::Interface,
                        start_line: node.start_position().row + 1,
                        end_line: node.end_position().row + 1,
                        signature: get_signature(node, source),
                    });
                }
            }
            "type_item" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    symbols.push(Symbol {
                        name: get_node_text(&name_node, source).to_string(),
                        kind: SymbolKind::TypeAlias,
                        start_line: node.start_position().row + 1,
                        end_line: node.end_position().row + 1,
                        signature: get_signature(node, source),
                    });
                }
            }
            _ => {}
        }

        for i in 0..node.child_count() {
            if let Some(c) = node.child(i) {
                walk_rust(&c, source, symbols);
            }
        }
    }

    walk_rust(&root, source, &mut symbols);
    symbols
}

fn extract_typescript_symbols(source: &[u8], is_tsx: bool) -> Vec<Symbol> {
    let mut parser = Parser::new();
    let language: Language = if is_tsx {
        tree_sitter_typescript::LANGUAGE_TSX.into()
    } else {
        tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
    };

    if parser.set_language(&language).is_err() {
        return fallback_extract_symbols(source, SupportedLanguage::TypeScript);
    }

    let tree = match parser.parse(source, None) {
        Some(t) => t,
        None => return fallback_extract_symbols(source, SupportedLanguage::TypeScript),
    };

    let mut symbols = Vec::new();
    let root = tree.root_node();

    fn walk_ts(node: &Node, source: &[u8], symbols: &mut Vec<Symbol>) {
        let kind = node.kind();
        match kind {
            "function_declaration" | "generator_function_declaration" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    symbols.push(Symbol {
                        name: get_node_text(&name_node, source).to_string(),
                        kind: SymbolKind::Function,
                        start_line: node.start_position().row + 1,
                        end_line: node.end_position().row + 1,
                        signature: get_signature(node, source),
                    });
                }
            }
            "method_definition" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    symbols.push(Symbol {
                        name: get_node_text(&name_node, source).to_string(),
                        kind: SymbolKind::Method,
                        start_line: node.start_position().row + 1,
                        end_line: node.end_position().row + 1,
                        signature: get_signature(node, source),
                    });
                }
            }
            "class_declaration" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    symbols.push(Symbol {
                        name: get_node_text(&name_node, source).to_string(),
                        kind: SymbolKind::Class,
                        start_line: node.start_position().row + 1,
                        end_line: node.end_position().row + 1,
                        signature: get_signature(node, source),
                    });
                }
            }
            "interface_declaration" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    symbols.push(Symbol {
                        name: get_node_text(&name_node, source).to_string(),
                        kind: SymbolKind::Interface,
                        start_line: node.start_position().row + 1,
                        end_line: node.end_position().row + 1,
                        signature: get_signature(node, source),
                    });
                }
            }
            "type_alias_declaration" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    symbols.push(Symbol {
                        name: get_node_text(&name_node, source).to_string(),
                        kind: SymbolKind::TypeAlias,
                        start_line: node.start_position().row + 1,
                        end_line: node.end_position().row + 1,
                        signature: get_signature(node, source),
                    });
                }
            }
            "enum_declaration" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    symbols.push(Symbol {
                        name: get_node_text(&name_node, source).to_string(),
                        kind: SymbolKind::Enum,
                        start_line: node.start_position().row + 1,
                        end_line: node.end_position().row + 1,
                        signature: get_signature(node, source),
                    });
                }
            }
            "variable_declarator" => {
                // Catch: const foo = () => ... or const bar = function(...)
                if let Some(val) = node.child_by_field_name("value") {
                    if val.kind() == "arrow_function" || val.kind() == "function_expression" {
                        if let Some(name_node) = node.child_by_field_name("name") {
                            symbols.push(Symbol {
                                name: get_node_text(&name_node, source).to_string(),
                                kind: SymbolKind::Function,
                                start_line: node.start_position().row + 1,
                                end_line: val.end_position().row + 1,
                                signature: get_signature(node, source),
                            });
                        }
                    }
                }
            }
            _ => {}
        }

        for i in 0..node.child_count() {
            if let Some(c) = node.child(i) {
                walk_ts(&c, source, symbols);
            }
        }
    }

    walk_ts(&root, source, &mut symbols);
    symbols
}

pub fn fallback_extract_symbols(source: &[u8], lang: SupportedLanguage) -> Vec<Symbol> {
    let text = match std::str::from_utf8(source) {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };

    let mut symbols = Vec::new();
    let lines: Vec<&str> = text.lines().collect();

    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        let line_num = idx + 1;

        if lang == SupportedLanguage::Python {
            if let Some(rest) = trimmed.strip_prefix("def ") {
                let name = rest
                    .split('(')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .trim_end_matches(':');
                if !name.is_empty() {
                    symbols.push(Symbol {
                        name: name.to_string(),
                        kind: SymbolKind::Function,
                        start_line: line_num,
                        end_line: line_num,
                        signature: Some(trimmed.to_string()),
                    });
                }
            } else if let Some(rest) = trimmed.strip_prefix("class ") {
                let name = rest.split(['(', ':']).next().unwrap_or("").trim();
                if !name.is_empty() {
                    symbols.push(Symbol {
                        name: name.to_string(),
                        kind: SymbolKind::Class,
                        start_line: line_num,
                        end_line: line_num,
                        signature: Some(trimmed.to_string()),
                    });
                }
            }
        } else {
            // General language heuristics
            if trimmed.starts_with("fn ")
                || trimmed.starts_with("pub fn ")
                || trimmed.starts_with("async fn ")
            {
                let after = trimmed.split("fn ").nth(1).unwrap_or("");
                let name = after.split(['(', '<']).next().unwrap_or("").trim();
                if !name.is_empty() {
                    symbols.push(Symbol {
                        name: name.to_string(),
                        kind: SymbolKind::Function,
                        start_line: line_num,
                        end_line: line_num,
                        signature: Some(trimmed.to_string()),
                    });
                }
            } else if trimmed.starts_with("function ") || trimmed.starts_with("export function ") {
                let after = trimmed.split("function ").nth(1).unwrap_or("");
                let name = after.split(['(', '<']).next().unwrap_or("").trim();
                if !name.is_empty() {
                    symbols.push(Symbol {
                        name: name.to_string(),
                        kind: SymbolKind::Function,
                        start_line: line_num,
                        end_line: line_num,
                        signature: Some(trimmed.to_string()),
                    });
                }
            }
        }
    }

    symbols
}

pub fn extract_symbols_from_source(source: &[u8], file_path: &str) -> FileSymbolsReport {
    let language = detect_language(file_path);
    let symbols = match language {
        SupportedLanguage::Rust => extract_rust_symbols(source),
        SupportedLanguage::TypeScript | SupportedLanguage::JavaScript => {
            extract_typescript_symbols(source, false)
        }
        SupportedLanguage::TSX => extract_typescript_symbols(source, true),
        SupportedLanguage::Python => fallback_extract_symbols(source, SupportedLanguage::Python),
        SupportedLanguage::Unknown => fallback_extract_symbols(source, SupportedLanguage::Unknown),
    };

    FileSymbolsReport {
        file_path: file_path.to_string(),
        language: language.as_str().to_string(),
        symbols,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffHunk {
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub added_line_numbers: Vec<usize>,
    pub modified_line_numbers: Vec<usize>,
}

pub fn parse_unified_diff_hunks(diff_patch: &str) -> Vec<DiffHunk> {
    let mut hunks = Vec::new();
    let mut current_hunk: Option<DiffHunk> = None;
    let mut current_new_line = 0;

    for line in diff_patch.lines() {
        if line.starts_with("@@ ") {
            if let Some(h) = current_hunk.take() {
                hunks.push(h);
            }
            // Parse @@ -old_start,old_lines +new_start,new_lines @@
            if let Some(parts) = parse_hunk_header(line) {
                current_new_line = parts.new_start;
                current_hunk = Some(DiffHunk {
                    old_start: parts.old_start,
                    old_lines: parts.old_lines,
                    new_start: parts.new_start,
                    new_lines: parts.new_lines,
                    added_line_numbers: Vec::new(),
                    modified_line_numbers: Vec::new(),
                });
            }
        } else if let Some(ref mut hunk) = current_hunk {
            if line.starts_with('+') && !line.starts_with("+++") {
                hunk.added_line_numbers.push(current_new_line);
                hunk.modified_line_numbers.push(current_new_line);
                current_new_line += 1;
            } else if line.starts_with('-') && !line.starts_with("---") {
                // Deletion affects current line boundary in new file
                hunk.modified_line_numbers.push(current_new_line);
            } else if line.starts_with(' ') {
                current_new_line += 1;
            }
        }
    }

    if let Some(h) = current_hunk {
        hunks.push(h);
    }

    hunks
}

struct HunkHeaderParts {
    old_start: usize,
    old_lines: usize,
    new_start: usize,
    new_lines: usize,
}

fn parse_hunk_header(line: &str) -> Option<HunkHeaderParts> {
    // Expected format: @@ -a,b +c,d @@ ...
    let segments: Vec<&str> = line.split("@@").collect();
    if segments.len() < 2 {
        return None;
    }
    let inner = segments[1].trim();
    let parts: Vec<&str> = inner.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }

    let parse_range = |s: &str| -> Option<(usize, usize)> {
        let clean = s.trim_start_matches(['-', '+']);
        if let Some((start, count)) = clean.split_once(',') {
            Some((start.parse().ok()?, count.parse().ok()?))
        } else {
            Some((clean.parse().ok()?, 1))
        }
    };

    let (old_start, old_lines) = parse_range(parts[0])?;
    let (new_start, new_lines) = parse_range(parts[1])?;

    Some(HunkHeaderParts {
        old_start,
        old_lines,
        new_start,
        new_lines,
    })
}

pub fn map_symbols_to_diff(
    symbols: &[Symbol],
    diff_patch: &str,
    file_path: &str,
) -> Vec<ChangedSymbol> {
    let hunks = parse_unified_diff_hunks(diff_patch);
    let mut touched_lines = HashSet::new();
    let mut added_lines = HashSet::new();

    for h in &hunks {
        for l in &h.modified_line_numbers {
            touched_lines.insert(*l);
        }
        for l in &h.added_line_numbers {
            added_lines.insert(*l);
        }
    }

    let mut changed = Vec::new();

    for sym in symbols {
        let sym_range = sym.start_line..=sym.end_line;
        let has_change = sym_range.clone().any(|l| touched_lines.contains(&l));

        if has_change {
            // If all lines in the symbol were newly added lines
            let all_added = sym_range.clone().all(|l| added_lines.contains(&l));
            let change_kind = if all_added {
                ChangeKind::Added
            } else {
                ChangeKind::Modified
            };

            changed.push(ChangedSymbol {
                symbol: sym.clone(),
                file_path: file_path.to_string(),
                change_kind,
            });
        }
    }

    changed
}

pub fn analyze_file_diff_symbols(
    current_source: &[u8],
    diff_patch: &str,
    file_path: &str,
) -> DiffSymbolsReport {
    let report = extract_symbols_from_source(current_source, file_path);
    let changed_symbols = map_symbols_to_diff(&report.symbols, diff_patch, file_path);

    DiffSymbolsReport {
        file_path: file_path.to_string(),
        language: report.language,
        total_symbols: report.symbols.len(),
        changed_symbols,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSymbolsReport {
    pub commit_sha: String,
    pub author_name: String,
    pub author_email: String,
    pub message: String,
    pub files: Vec<DiffSymbolsReport>,
}

fn run_git(repo: &Path, args: &[&str], max_output: usize) -> Result<String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env(
            "GIT_CONFIG_GLOBAL",
            if cfg!(windows) { "NUL" } else { "/dev/null" },
        )
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .env("PAGER", "cat")
        .output()
        .context("Could not execute git")?;
    if !output.status.success() {
        bail!("git {} failed", args.first().unwrap_or(&"command"));
    }
    if output.stdout.len() > max_output {
        bail!("git output exceeded limit");
    }
    String::from_utf8(output.stdout).context("git output was not UTF-8")
}

pub fn analyze_git_commit_symbols(repo: &Path, commit_sha: &str) -> Result<CommitSymbolsReport> {
    if !repo.is_dir() {
        bail!("Invalid repository path");
    }
    let sha_clean = commit_sha.trim();
    if sha_clean.len() < 7 || !sha_clean.chars().all(|c| c.is_ascii_hexdigit()) {
        bail!("Invalid commit SHA");
    }

    let meta_raw = run_git(
        repo,
        &["log", "-1", "--format=%H%x1f%an%x1f%ae%x1f%s", sha_clean],
        4096,
    )?;
    let meta_parts: Vec<&str> = meta_raw.trim().split('\x1f').collect();
    if meta_parts.len() < 4 {
        bail!("Could not parse commit metadata");
    }
    let full_sha = meta_parts[0].to_string();
    let author_name = meta_parts[1].to_string();
    let author_email = meta_parts[2].to_string();
    let message = meta_parts[3].to_string();

    let files_raw = run_git(
        repo,
        &[
            "diff-tree",
            "--no-commit-id",
            "--name-only",
            "-r",
            sha_clean,
        ],
        1_000_000,
    )?;
    let file_paths: Vec<&str> = files_raw
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();

    let mut reports = Vec::new();

    for file_path in file_paths {
        let blob_arg = format!("{sha_clean}:{file_path}");
        let source_res = run_git(repo, &["show", &blob_arg], 5_000_000);
        let source = match source_res {
            Ok(s) => s.into_bytes(),
            Err(_) => Vec::new(),
        };

        let diff_res = run_git(
            repo,
            &["show", "--format=", "--patch", sha_clean, "--", file_path],
            5_000_000,
        );
        let diff = diff_res.unwrap_or_default();

        let report = analyze_file_diff_symbols(&source, &diff, file_path);
        reports.push(report);
    }

    Ok(CommitSymbolsReport {
        commit_sha: full_sha,
        author_name,
        author_email,
        message,
        files: reports,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_rust_symbols() {
        let code = r#"
pub mod network;

pub struct ServerConfig {
    pub port: u16,
}

pub enum Protocol {
    Http,
    Ws,
}

pub trait Handler {
    fn handle(&self);
}

pub fn start_server(cfg: ServerConfig) -> bool {
    true
}
"#;
        let report = extract_symbols_from_source(code.as_bytes(), "src/lib.rs");
        assert_eq!(report.language, "rust");

        let names: Vec<&str> = report.symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"network"));
        assert!(names.contains(&"ServerConfig"));
        assert!(names.contains(&"Protocol"));
        assert!(names.contains(&"Handler"));
        assert!(names.contains(&"start_server"));

        let start_fn = report
            .symbols
            .iter()
            .find(|s| s.name == "start_server")
            .unwrap();
        assert_eq!(start_fn.kind, SymbolKind::Function);
        assert!(start_fn
            .signature
            .as_ref()
            .unwrap()
            .contains("fn start_server"));
    }

    #[test]
    fn test_extract_typescript_symbols() {
        let code = r#"
export interface User {
    id: string;
    name: string;
}

export type UserId = string;

export class AuthService {
    login(): boolean {
        return true;
    }
}

export function verifyToken(token: string): boolean {
    return token.length > 0;
}

export const helper = () => 42;
"#;
        let report = extract_symbols_from_source(code.as_bytes(), "src/auth.ts");
        assert_eq!(report.language, "typescript");

        let names: Vec<&str> = report.symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"User"));
        assert!(names.contains(&"UserId"));
        assert!(names.contains(&"AuthService"));
        assert!(names.contains(&"login"));
        assert!(names.contains(&"verifyToken"));
        assert!(names.contains(&"helper"));

        let user_iface = report.symbols.iter().find(|s| s.name == "User").unwrap();
        assert_eq!(user_iface.kind, SymbolKind::Interface);
    }

    #[test]
    fn test_fallback_python_symbols() {
        let code = r#"
class DataProcessor:
    def process(self):
        pass

def run_pipeline():
    return True
"#;
        let report = extract_symbols_from_source(code.as_bytes(), "scripts/data.py");
        assert_eq!(report.language, "python");

        let names: Vec<&str> = report.symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"DataProcessor"));
        assert!(names.contains(&"run_pipeline"));
    }

    #[test]
    fn test_diff_hunk_parsing_and_symbol_mapping() {
        let code = r#"export function computeSum(a: number, b: number): number {
    return a + b;
}

export function computeProduct(a: number, b: number): number {
    return a * b;
}
"#;
        let diff = r#"@@ -2,2 +2,3 @@
-    return a + b;
+    const sum = a + b;
+    return sum;
"#;
        let report = analyze_file_diff_symbols(code.as_bytes(), diff, "src/math.ts");
        assert_eq!(report.total_symbols, 2);
        assert_eq!(report.changed_symbols.len(), 1);

        let changed = &report.changed_symbols[0];
        assert_eq!(changed.symbol.name, "computeSum");
        assert_eq!(changed.change_kind, ChangeKind::Modified);
    }
}
