const LOCAL_GUIDE_URL = 'http://localhost:4173/';

/** Public, build-time URL; never put credentials or secret material here. */
export function resolveJudgeGuideUrl(configuredUrl: string | undefined, isDevelopment: boolean): string | null {
  const value = configuredUrl?.trim();
  if (!value) return isDevelopment ? LOCAL_GUIDE_URL : null;

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
