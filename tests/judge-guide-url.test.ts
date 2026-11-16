import { describe, expect, it } from 'vitest';
import { resolveJudgeGuideUrl } from '@/lib/judge-guide';

describe('judge guide URL', () => {
  it('uses the local guide server only in development when unset', () => {
    expect(resolveJudgeGuideUrl(undefined, true)).toBe('http://localhost:4173/');
    expect(resolveJudgeGuideUrl(' ', false)).toBeNull();
  });

  it('accepts a configured absolute HTTP(S) URL', () => {
    expect(resolveJudgeGuideUrl(' https://example.org/guide ', false)).toBe('https://example.org/guide');
    expect(resolveJudgeGuideUrl('http://localhost:5000/', true)).toBe('http://localhost:5000/');
  });

  it('does not turn invalid or unsafe configuration into a link', () => {
    for (const value of ['/relative', '//example.org', 'javascript:alert(1)', 'https://user:pass@example.org', 'not a url']) {
      expect(resolveJudgeGuideUrl(value, true)).toBeNull();
    }
  });
});
