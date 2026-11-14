'use client';

import { Check, Copy, Download, FileText } from 'lucide-react';
import React, { useState } from 'react';

interface MarkdownDocumentViewerProps {
  markdown: string;
  filename?: string;
  onDownload?: () => void;
}

export default function MarkdownDocumentViewer({
  markdown,
  filename = 'rev-handover.md',
  onDownload,
}: MarkdownDocumentViewerProps) {
  const [viewMode, setViewMode] = useState<'rendered' | 'raw'>('rendered');
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(markdown).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="m3-doc-viewer-container">
      {/* Viewer Header / Toolbar */}
      <div className="m3-doc-viewer-toolbar">
        <div className="m3-doc-viewer-meta">
          <span className="m3-doc-icon"><FileText size={16} aria-hidden="true" /></span>
          <strong>{filename}</strong>
          <span className="m3-doc-badge">Verified Document</span>
        </div>

        <div className="m3-doc-viewer-actions">
          <div className="m3-segmented-control-mini" role="tablist">
            <button
              type="button"
              className={`m3-mini-tab ${viewMode === 'rendered' ? 'active' : ''}`}
              onClick={() => setViewMode('rendered')}
            >
              Document Preview
            </button>
            <button
              type="button"
              className={`m3-mini-tab ${viewMode === 'raw' ? 'active' : ''}`}
              onClick={() => setViewMode('raw')}
            >
              Raw Markdown
            </button>
          </div>

          <button
            type="button"
            className="m3-btn-subtle-sm"
            onClick={handleCopy}
            title="Copy entire markdown to clipboard"
          >
            {copied ? <><Check size={16} aria-hidden="true" /> Copied</> : <><Copy size={16} aria-hidden="true" /> Copy</>}
          </button>

          {onDownload && (
            <button
              type="button"
              className="m3-btn-subtle-sm"
              onClick={onDownload}
              title="Download markdown file"
            >
              <Download size={16} aria-hidden="true" /> Download
            </button>
          )}
        </div>
      </div>

      {/* Viewer Canvas */}
      <div className="m3-doc-viewer-canvas">
        {viewMode === 'rendered' ? (
          <article className="m3-rendered-markdown">
            {renderMarkdownBlocks(markdown)}
          </article>
        ) : (
          <pre className="m3-raw-markdown-pre">
            <code>{markdown}</code>
          </pre>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Native Markdown Block Parser & Renderer
// ---------------------------------------------------------------------------

function renderMarkdownBlocks(markdown: string): React.ReactNode[] {
  const lines = markdown.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Heading 1 (# ...)
    if (line.startsWith('# ')) {
      nodes.push(
        <h1 key={`h1-${i}`} className="md-h1">
          {renderInline(line.slice(2))}
        </h1>
      );
      i++;
      continue;
    }

    // Heading 2 (## ...)
    if (line.startsWith('## ')) {
      nodes.push(
        <h2 key={`h2-${i}`} className="md-h2">
          {renderInline(line.slice(3))}
        </h2>
      );
      i++;
      continue;
    }

    // Heading 3 (### ...)
    if (line.startsWith('### ')) {
      nodes.push(
        <h3 key={`h3-${i}`} className="md-h3">
          {renderInline(line.slice(4))}
        </h3>
      );
      i++;
      continue;
    }

    // Blockquote (> ...)
    if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        <blockquote key={`quote-${i}`} className="md-blockquote">
          {quoteLines.map((ql, qi) => (
            <p key={`qp-${qi}`}>{renderInline(ql)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // Table (| a | b |)
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableRows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableRows.push(lines[i].trim());
        i++;
      }

      if (tableRows.length >= 2) {
        const headerCols = tableRows[0]
          .split('|')
          .slice(1, -1)
          .map(c => c.trim());
        const dataRows = tableRows.slice(2); // Skip separator row

        nodes.push(
          <div key={`table-wrapper-${i}`} className="md-table-wrapper">
            <table className="md-table">
              <thead>
                <tr>
                  {headerCols.map((col, ci) => (
                    <th key={`th-${ci}`}>{renderInline(col)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row, ri) => {
                  const cols = row
                    .split('|')
                    .slice(1, -1)
                    .map(c => c.trim());
                  return (
                    <tr key={`tr-${ri}`}>
                      {cols.map((col, ci) => (
                        <td key={`td-${ri}-${ci}`}>{renderInline(col)}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    // Bullet List (- ...)
    if (line.startsWith('- ')) {
      const listItems: string[] = [];
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('  '))) {
        if (lines[i].startsWith('- ')) {
          listItems.push(lines[i].slice(2));
        } else if (listItems.length > 0) {
          listItems[listItems.length - 1] += ' ' + lines[i].trim();
        }
        i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="md-ul">
          {listItems.map((item, li) => (
            <li key={`li-${li}`}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Normal Paragraph
    nodes.push(
      <p key={`p-${i}`} className="md-p">
        {renderInline(line)}
      </p>
    );
    i++;
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Inline Markdown Parser
// ---------------------------------------------------------------------------

function renderInline(text: string): React.ReactNode {
  // Replace bold, code, links
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let keyIdx = 0;

  while (remaining.length > 0) {
    // 1. Inline Link [label](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
    if (linkMatch) {
      parts.push(
        <a
          key={`link-${keyIdx++}`}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="md-link"
        >
          {linkMatch[1]}
        </a>
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // 2. Bold text **bold**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      parts.push(
        <strong key={`bold-${keyIdx++}`} className="md-bold">
          {boldMatch[1]}
        </strong>
      );
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // 3. Inline code `code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        <code key={`code-${keyIdx++}`} className="md-code">
          {codeMatch[1]}
        </code>
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // 4. Regular characters until next token
    const nextTokenIdx = remaining.search(/\[|\*\*|`/);
    if (nextTokenIdx === -1) {
      parts.push(remaining);
      break;
    } else if (nextTokenIdx > 0) {
      parts.push(remaining.slice(0, nextTokenIdx));
      remaining = remaining.slice(nextTokenIdx);
    } else {
      // Just a lone token character that didn't match a full regex
      parts.push(remaining[0]);
      remaining = remaining.slice(1);
    }
  }

  return parts;
}
