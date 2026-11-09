use anyhow::{bail, Context, Result};
use reqwest::{header, Client, Response};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashSet;
use std::time::Duration;

use crate::{artifact, field, ImportResult};

const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 2;
const MAX_DETAIL_COMMITS: usize = 10;
const MAX_RESPONSE_BYTES: usize = 8_000_000;

#[derive(Debug, Clone)]
pub struct GitHubConfig {
    pub api_base: String,
    pub max_pages: usize,
    pub detail_commits: usize,
}
impl Default for GitHubConfig {
    fn default() -> Self {
        Self {
            api_base: "https://api.github.com".into(),
            max_pages: MAX_PAGES,
            detail_commits: MAX_DETAIL_COMMITS,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitFile {
    filename: String,
    status: Option<String>,
    patch: Option<String>,
}

fn repo_path_is_valid(repo: &str) -> bool {
    let parts: Vec<_> = repo.split('/').collect();
    parts.len() == 2
        && parts.iter().all(|p| {
            !p.is_empty()
                && *p != "."
                && *p != ".."
                && p.len() <= 100
                && p.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        })
}
fn safe_sha(s: &str) -> bool {
    (7..=64).contains(&s.len()) && s.bytes().all(|c| c.is_ascii_hexdigit())
}
fn string_field<'a>(v: &'a Value, path: &str) -> Option<&'a str> {
    field(v, path).filter(|s| !s.trim().is_empty())
}

async fn response_json(mut response: Response) -> Result<Value> {
    if !response.status().is_success() {
        let status = response.status();
        let rate = response
            .headers()
            .get("x-ratelimit-remaining")
            .and_then(|x| x.to_str().ok());
        if status.as_u16() == 429 || (status.as_u16() == 403 && rate == Some("0")) {
            bail!("GitHub API rate limit reached (HTTP {})", status.as_u16());
        }
        bail!("GitHub API returned HTTP {}", status.as_u16());
    }
    if response
        .content_length()
        .is_some_and(|n| n > MAX_RESPONSE_BYTES as u64)
    {
        bail!("GitHub response exceeded size limit");
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .context("GitHub response read failed")?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            bail!("GitHub response exceeded size limit");
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).context("GitHub returned invalid JSON")
}
fn request(client: &Client, url: &str, token: Option<&str>) -> reqwest::RequestBuilder {
    let r = client
        .get(url)
        .header(header::ACCEPT, "application/vnd.github+json");
    if let Some(t) = token.filter(|t| !t.is_empty()) {
        r.bearer_auth(t)
    } else {
        r
    }
}
async fn fetch_pages(
    client: &Client,
    base: &str,
    repo: &str,
    resource: &str,
    extra: &str,
    token: Option<&str>,
    max_pages: usize,
    warnings: &mut Vec<String>,
) -> Vec<Value> {
    let mut values = Vec::new();
    for page in 1..=max_pages {
        let url = format!(
            "{}/repos/{repo}/{resource}?per_page={PAGE_SIZE}&page={page}{extra}",
            base.trim_end_matches('/')
        );
        let response = match request(client, &url, token).send().await {
            Ok(r) => r,
            Err(_) => {
                warnings.push(format!(
                    "{resource}: GitHub request failed or timed out on page {page}"
                ));
                break;
            }
        };
        let has_next = response
            .headers()
            .get(header::LINK)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.contains("rel=\"next\""));
        match response_json(response).await {
            Ok(Value::Array(items)) => values.extend(items),
            Ok(_) => {
                warnings.push(format!("{resource}: GitHub returned a non-array response"));
                break;
            }
            Err(err) => {
                warnings.push(format!("{resource}: {err}"));
                break;
            }
        }
        if !has_next {
            break;
        }
        if page == max_pages {
            warnings.push(format!(
                "{resource}: limited to {} records; additional pages were not imported",
                PAGE_SIZE * max_pages
            ));
        }
    }
    values
}

fn github_username_is_valid(username: &str) -> bool {
    if username.is_empty()
        || username.len() > 39
        || username.starts_with('-')
        || username.ends_with('-')
        || username.contains("--")
    {
        return false;
    }
    username
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || c == b'-')
}

async fn fetch_commits_by_author(
    client: &Client,
    base: &str,
    repo: &str,
    username: &str,
    token: Option<&str>,
    max_pages: usize,
    warnings: &mut Vec<String>,
) -> Vec<Value> {
    let extra = format!("&author={username}");
    let warning_start = warnings.len();
    let mut results = fetch_pages(
        client, base, repo, "commits", &extra, token, max_pages, warnings,
    )
    .await;
    for warning in &mut warnings[warning_start..] {
        *warning = format!("contributor commits: {warning}");
    }
    let mut other = 0usize;
    let mut unlinked = 0usize;
    results.retain(|commit| match string_field(commit, "/author/login") {
        Some(login) if login.eq_ignore_ascii_case(username) => true,
        Some(_) => {
            other += 1;
            false
        }
        None => {
            unlinked += 1;
            false
        }
    });
    if other > 0 || unlinked > 0 {
        warnings.push(format!("contributor commits: excluded {other} differently linked and {unlinked} unlinked returned records; aliases require manual confirmation"));
    }
    results
}

pub fn normalize_discussions(
    repo: &str,
    review_comments: &[Value],
    issue_comments: &[Value],
) -> ImportResult {
    let mut artifacts = Vec::new();
    let mut warnings = Vec::new();
    let mut seen = HashSet::new();
    for (kind, items) in [
        ("github_review_comment", review_comments),
        ("github_discussion_comment", issue_comments),
    ] {
        for item in items {
            let Some(id) = item.get("id").and_then(Value::as_u64) else {
                warnings.push(format!("{kind}: skipped comment without ID"));
                continue;
            };
            let Some(body) = string_field(item, "/body") else {
                warnings.push(format!("{kind}: skipped empty comment {id}"));
                continue;
            };
            if !seen.insert((kind, id)) {
                continue;
            }
            let url = string_field(item, "/html_url")
                .filter(|u| u.starts_with(&format!("https://github.com/{repo}/")))
                .map(str::to_owned);
            let source_ref = format!("{repo} {kind} #{id}");
            let mut source = artifact(
                kind,
                id.to_string(),
                body.into(),
                string_field(item, "/user/login").map(str::to_owned),
                string_field(item, "/created_at").map(str::to_owned),
                url,
                source_ref,
            );
            source.github_login = string_field(item, "/user/login").map(str::to_owned);
            artifacts.push(source);
        }
    }
    ImportResult {
        artifacts,
        warnings,
    }
}

pub fn normalize_commit_details(repo: &str, detail: &Value) -> ImportResult {
    let mut artifacts = Vec::new();
    let mut warnings = Vec::new();
    let Some(sha) = string_field(detail, "/sha").filter(|s| safe_sha(s)) else {
        return ImportResult {
            artifacts,
            warnings: vec!["commit detail: missing or invalid SHA".into()],
        };
    };
    let Some(files) = detail.get("files").and_then(Value::as_array) else {
        return ImportResult {
            artifacts,
            warnings: vec![format!("commit {sha}: changed-file data unavailable")],
        };
    };
    if files.len() >= 300 {
        warnings.push(format!("commit {sha}: GitHub may have more than 300 changed files; only returned files imported"));
    }
    let mut seen = HashSet::new();
    for item in files {
        let Ok(file) = serde_json::from_value::<GitFile>(item.clone()) else {
            warnings.push(format!("commit {sha}: invalid changed file"));
            continue;
        };
        if file.filename.is_empty() || !seen.insert(file.filename.clone()) {
            continue;
        }
        let Some(patch) = file.patch.filter(|s| !s.is_empty()) else {
            warnings.push(format!(
                "commit {sha}: patch unavailable for {} (binary, large, or omitted)",
                file.filename
            ));
            continue;
        };
        let text = patch;
        let reference = format!(
            "{repo}@{sha} file {} ({})",
            file.filename,
            file.status.as_deref().unwrap_or("unknown")
        );
        let mut source = artifact(
            "github_commit_patch",
            format!("{sha}:{}", file.filename),
            text,
            string_field(detail, "/commit/author/name").map(str::to_owned),
            string_field(detail, "/commit/author/date").map(str::to_owned),
            Some(format!("https://github.com/{repo}/commit/{sha}")),
            reference,
        );
        source.github_login = string_field(detail, "/author/login").map(str::to_owned);
        artifacts.push(source);
    }
    ImportResult {
        artifacts,
        warnings,
    }
}

pub async fn import(
    repo: &str,
    token: Option<&str>,
    config: &GitHubConfig,
    contributor: Option<&str>,
) -> Result<ImportResult> {
    if !repo_path_is_valid(repo) {
        bail!("Repository must be owner/name using letters, numbers, dash, underscore or dot");
    }
    if !(1..=10).contains(&config.max_pages) || config.detail_commits > 50 {
        bail!("GitHub import limits are invalid");
    }
    if contributor.is_some_and(|value| !github_username_is_valid(value)) {
        bail!("Invalid GitHub contributor username");
    }
    let client = Client::builder()
        .user_agent("ReV-handover/0.1")
        .timeout(Duration::from_secs(25))
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let mut warnings = Vec::new();
    let commits = fetch_pages(
        &client,
        &config.api_base,
        repo,
        "commits",
        "",
        token,
        config.max_pages,
        &mut warnings,
    )
    .await;
    let pulls = fetch_pages(
        &client,
        &config.api_base,
        repo,
        "pulls",
        "&state=all",
        token,
        config.max_pages,
        &mut warnings,
    )
    .await;
    let review_comments = fetch_pages(
        &client,
        &config.api_base,
        repo,
        "pulls/comments",
        "",
        token,
        config.max_pages,
        &mut warnings,
    )
    .await;
    let issue_comments = fetch_pages(
        &client,
        &config.api_base,
        repo,
        "issues/comments",
        "",
        token,
        config.max_pages,
        &mut warnings,
    )
    .await;
    let mut result = crate::normalize_github(repo, &commits, &pulls);
    let mut comments = normalize_discussions(repo, &review_comments, &issue_comments);
    result.artifacts.append(&mut comments.artifacts);
    warnings.append(&mut comments.warnings);
    if commits.len() > config.detail_commits {
        warnings.push(format!("commit patches: limited to the newest {} commits; remaining commit patches not imported",config.detail_commits));
    }
    for commit in commits.iter().take(config.detail_commits) {
        let Some(sha) = string_field(commit, "/sha").filter(|s| safe_sha(s)) else {
            warnings.push("commit patches: skipped invalid SHA".into());
            continue;
        };
        let url = format!(
            "{}/repos/{repo}/commits/{sha}",
            config.api_base.trim_end_matches('/')
        );
        match request(&client, &url, token).send().await {
            Ok(response) => match response_json(response).await {
                Ok(detail) => {
                    let mut normalized = normalize_commit_details(repo, &detail);
                    result.artifacts.append(&mut normalized.artifacts);
                    warnings.append(&mut normalized.warnings);
                }
                Err(err) => warnings.push(format!("commit {sha}: {err}")),
            },
            Err(_) => warnings.push(format!("commit {sha}: GitHub request failed or timed out")),
        }
    }
    if let Some(username) = contributor {
        let matching = fetch_commits_by_author(
            &client,
            &config.api_base,
            repo,
            username,
            token,
            config.max_pages,
            &mut warnings,
        )
        .await;
        let mut extra = crate::normalize_github(repo, &matching, &[]);
        let mut seen: HashSet<(String, String)> = result
            .artifacts
            .iter()
            .map(|a| (a.kind.clone(), a.external_id.clone()))
            .collect();
        result.artifacts.extend(
            extra
                .artifacts
                .drain(..)
                .filter(|a| seen.insert((a.kind.clone(), a.external_id.clone()))),
        );
        warnings.extend(extra.warnings);
        if matching.len() > config.detail_commits {
            warnings.push(format!(
                "contributor commit patches: limited to {} commits; remaining patches not imported",
                config.detail_commits
            ));
        }
        for commit in matching.iter().take(config.detail_commits) {
            let Some(sha) = string_field(commit, "/sha").filter(|s| safe_sha(s)) else {
                warnings.push("contributor patches: skipped invalid SHA".into());
                continue;
            };
            let url = format!(
                "{}/repos/{repo}/commits/{sha}",
                config.api_base.trim_end_matches('/')
            );
            match request(&client, &url, token).send().await {
                Ok(response) => match response_json(response).await {
                    Ok(detail) => {
                        if string_field(&detail, "/author/login")
                            .is_some_and(|login| login.eq_ignore_ascii_case(username))
                        {
                            let mut normalized = normalize_commit_details(repo, &detail);
                            result.artifacts.extend(
                                normalized.artifacts.drain(..).filter(|a| {
                                    seen.insert((a.kind.clone(), a.external_id.clone()))
                                }),
                            );
                            warnings.append(&mut normalized.warnings);
                        } else {
                            warnings.push(format!("contributor patch {sha}: account association missing or changed; skipped"));
                        }
                    }
                    Err(err) => warnings.push(format!("contributor commit {sha}: {err}")),
                },
                Err(_) => warnings.push(format!(
                    "contributor commit {sha}: GitHub request failed or timed out"
                )),
            }
        }
    }
    result.warnings.extend(warnings);
    if result.artifacts.is_empty() {
        bail!(
            "No GitHub activity imported. {}",
            result.warnings.join("; ")
        );
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn comments_are_individual_quoted_sources_with_untrusted_urls_filtered() {
        let c = json!({"id":12,"body":"Use Redis because it survives restart","html_url":"https://github.com/team/repo/pull/3#discussion_r12","user":{"login":"maya"},"created_at":"2026-01-01T00:00:00Z"});
        let malicious = json!({"id":13,"body":"x","html_url":"https://evil.example/pull/3"});
        let r = normalize_discussions("team/repo", &[c.clone(), c, malicious], &[]);
        assert_eq!(r.artifacts.len(), 2);
        assert_eq!(r.artifacts[0].text, "Use Redis because it survives restart");
        assert_eq!(r.artifacts[0].github_login.as_deref(), Some("maya"));
        assert_eq!(r.artifacts[1].github_login, None);
        assert!(r.artifacts[0].url.is_some());
        assert!(r.artifacts[1].url.is_none());
    }
    #[test]
    fn patch_normalization_preserves_exact_text_and_reports_missing() {
        let detail = json!({"sha":"abcdef1234567890","author":{"login":"maya"},"commit":{"author":{"name":"Maya","date":"2026-01-01T00:00:00Z"}},"files":[{"filename":"src/cache.ts","status":"modified","patch":"@@ -1 +1 @@\n-old\n+Redis"},{"filename":"image.png","status":"added"}]});
        let r = normalize_commit_details("team/repo", &detail);
        assert_eq!(r.artifacts.len(), 1);
        assert_eq!(r.artifacts[0].github_login.as_deref(), Some("maya"));
        assert_eq!(r.artifacts[0].text, "@@ -1 +1 @@\n-old\n+Redis");
        assert!(r.warnings[0].contains("patch unavailable"));
    }
    #[test]
    fn repo_and_sha_reject_path_injection() {
        assert!(repo_path_is_valid("a/b"));
        assert!(!repo_path_is_valid("a/../b"));
        assert!(!safe_sha("abc/../../etc"));
        assert!(github_username_is_valid("FeV-06"));
        for bad in ["", "@FeV-06", "a/b", "-a", "a-", "a--b", "two words"] {
            assert!(!github_username_is_valid(bad));
        }
    }
    #[tokio::test]
    async fn contributor_fetch_retains_only_explicit_account_matches_and_pagination_warnings() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            for _ in 0..2 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buffer = vec![0u8; 8192];
                let n = socket.read(&mut buffer).await.unwrap();
                let request = String::from_utf8_lossy(&buffer[..n]);
                assert!(request.contains("author=FeV-06"));
                let body = json!([
                    {"sha":"abc1234","author":{"login":"fev-06"},"commit":{"message":"mine"}},
                    {"sha":"def5678","author":null,"commit":{"message":"unlinked"}},
                    {"sha":"abc5678","author":{"login":"someone-else"},"commit":{"message":"other"}}
                ])
                .to_string();
                let reply=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nLink: <http://invalid>; rel=\"next\"\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body);
                socket.write_all(reply.as_bytes()).await.unwrap();
            }
        });
        let client = Client::new();
        let mut warnings = Vec::new();
        let commits = fetch_commits_by_author(
            &client,
            &format!("http://{addr}"),
            "a/b",
            "FeV-06",
            None,
            2,
            &mut warnings,
        )
        .await;
        server.await.unwrap();
        assert_eq!(commits.len(), 2);
        assert!(commits.iter().all(|c| c["author"]["login"] == "fev-06"));
        assert!(warnings.iter().any(|w| w.contains("additional pages")));
        assert!(warnings
            .iter()
            .any(|w| w.contains("2 differently linked and 2 unlinked")));
    }
    #[tokio::test]
    async fn imports_paginated_comments_and_patch_over_actual_http() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            for _ in 0..6 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut input = vec![0u8; 8192];
                let n = socket.read(&mut input).await.unwrap();
                let req = String::from_utf8_lossy(&input[..n]);
                let first = req.lines().next().unwrap_or("");
                let (body, link) = if first.contains("/commits?per_page=")
                    && first.contains("&page=1 ")
                {
                    (
                        json!([{"sha":"abcdef1234567890","commit":{"message":"Add Redis","author":{"name":"Maya"}}}]),
                        true,
                    )
                } else if first.contains("/commits?per_page=") && first.contains("&page=2 ") {
                    (json!([]), false)
                } else if first.contains("/pulls/comments?") {
                    (
                        json!([{"id":7,"body":"Use Redis","html_url":"https://github.com/a/b/pull/1#discussion_r7"}]),
                        false,
                    )
                } else if first.contains("/issues/comments?") {
                    (
                        json!([{"id":9,"body":"Needs tests","html_url":"https://github.com/a/b/issues/1#issuecomment-9"}]),
                        false,
                    )
                } else if first.contains("/commits/abcdef1234567890") {
                    (
                        json!({"sha":"abcdef1234567890","files":[{"filename":"cache.ts","status":"modified","patch":"@@ -1 +1 @@\n-old\n+Redis"}]}),
                        false,
                    )
                } else {
                    (json!([]), false)
                };
                let payload = body.to_string();
                let link_header = if link {
                    "Link: <https://example.invalid/page2>; rel=\"next\"\r\n"
                } else {
                    ""
                };
                let response=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n{link_header}Content-Length: {}\r\nConnection: close\r\n\r\n{}",payload.len(),payload);
                socket.write_all(response.as_bytes()).await.unwrap();
            }
        });
        let config = GitHubConfig {
            api_base: format!("http://{addr}"),
            max_pages: 2,
            detail_commits: 1,
        };
        let result = import("a/b", None, &config, None).await.unwrap();
        server.await.unwrap();
        for kind in [
            "github_commit",
            "github_review_comment",
            "github_discussion_comment",
            "github_commit_patch",
        ] {
            assert!(
                result.artifacts.iter().any(|a| a.kind == kind),
                "missing {kind}"
            );
        }
        assert!(result.warnings.is_empty(), "{:?}", result.warnings);
    }
}
