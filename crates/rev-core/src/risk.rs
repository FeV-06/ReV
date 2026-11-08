use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleRisk {
    pub path: String,
    pub total_lines: usize,
    pub departing_lines: usize,
    pub ownership_fraction: f64,
    pub churn_lines: usize,
    pub test_coverage: Option<f64>,
    pub score: f64,
    pub explanation: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskAnalysis {
    pub revision: String,
    pub modules: Vec<ModuleRisk>,
    pub warnings: Vec<String>,
}

/// Score is a prioritization heuristic, not an estimate of actual failure probability.
pub fn score(owned: usize, total: usize, churn: usize, coverage: Option<f64>) -> Option<f64> {
    if total == 0
        || owned > total
        || coverage.is_some_and(|x| !x.is_finite() || !(0.0..=1.0).contains(&x))
    {
        return None;
    }
    let ownership = owned as f64 / total as f64;
    let churn_factor = 1.0 + (churn as f64).ln_1p();
    let coverage_factor = coverage.map_or(1.0, |v| 1.0 - v);
    Some(ownership * churn_factor * coverage_factor)
}

fn git(repo: &Path, args: &[&str], max_output: usize) -> Result<String> {
    let output = Command::new("git")
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

pub fn analyze(repo: &Path, emails: &[String], max_files: usize) -> Result<RiskAnalysis> {
    if emails.is_empty() || emails.iter().any(|s| s.trim().is_empty() || s.len() > 320) {
        bail!("At least one author email is required");
    }
    if !(1..=500).contains(&max_files) {
        bail!("max_files must be 1..500");
    }
    let valid = git(repo, &["rev-parse", "--is-inside-work-tree"], 1024)?;
    if valid.trim() != "true" {
        bail!("Path is not a Git worktree");
    }
    let revision = git(repo, &["rev-parse", "HEAD"], 1024)?.trim().to_owned();
    let files = git(repo, &["ls-files", "-z"], 4_000_000)?;
    let paths: Vec<_> = files.split('\0').filter(|x| !x.is_empty()).collect();
    if paths.len() > max_files {
        bail!("Repository has {} tracked files, exceeding selected limit {max_files}; narrow the input repository",paths.len());
    }
    let normalized: Vec<String> = emails.iter().map(|s| s.trim().to_lowercase()).collect();
    let churn_output = git(
        repo,
        &[
            "log",
            "--since=90 days ago",
            "--numstat",
            "--format=",
            "--no-renames",
            "--",
        ],
        8_000_000,
    )?;
    let mut churn: HashMap<String, usize> = HashMap::new();
    for line in churn_output.lines() {
        let cols: Vec<_> = line.splitn(3, '\t').collect();
        if cols.len() != 3 {
            continue;
        }
        if let (Ok(a), Ok(d)) = (cols[0].parse::<usize>(), cols[1].parse::<usize>()) {
            *churn.entry(cols[2].to_string()).or_default() += a + d;
        }
    }
    let mut result = Vec::new();
    let mut warnings = Vec::new();
    for path in paths {
        let blame = match git(
            repo,
            &["blame", "--line-porcelain", "HEAD", "--", path],
            8_000_000,
        ) {
            Ok(v) => v,
            Err(_) => {
                warnings.push(format!(
                    "Could not analyze blame for {path}; omitted from results"
                ));
                continue;
            }
        };
        let mut total = 0;
        let mut owned = 0;
        for line in blame.lines() {
            if let Some(email) = line.strip_prefix("author-mail ") {
                total += 1;
                let email = email
                    .trim()
                    .trim_matches(|c| c == '<' || c == '>')
                    .to_lowercase();
                if normalized.contains(&email) {
                    owned += 1;
                }
            }
        }
        if total == 0 {
            continue;
        }
        let recent = *churn.get(path).unwrap_or(&0);
        let value = score(owned, total, recent, None).context("Invalid score inputs")?;
        result.push(ModuleRisk{path:path.into(),total_lines:total,departing_lines:owned,ownership_fraction:owned as f64/total as f64,churn_lines:recent,test_coverage:None,score:value,explanation:"Ownership is current HEAD blame; churn counts added/deleted lines in the last 90 days. Test coverage was not supplied and is not assumed.".into()});
    }
    result.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then_with(|| a.path.cmp(&b.path))
    });
    Ok(RiskAnalysis {
        revision,
        modules: result,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn score_does_not_invent_coverage() {
        assert_eq!(score(1, 2, 0, None), Some(0.5));
        assert_eq!(score(1, 2, 0, Some(0.5)), Some(0.25));
        assert_eq!(score(1, 0, 0, None), None);
        assert_eq!(score(2, 1, 0, None), None);
    }
    #[test]
    fn risk_ranks_higher_for_more_ownership_and_churn() {
        assert!(score(9, 10, 30, None).unwrap() > score(2, 10, 0, None).unwrap());
    }
}
