export async function readJsonLimited(request: Request | Response, limit: number): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new Error('Request body exceeds size limit');
  if (!request.body) throw new Error('Request body is required');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('Request body exceeds size limit'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
  } catch (e) {
    if (e instanceof Error && e.message === 'Request body exceeds size limit') throw e;
    throw new Error('Invalid JSON request body');
  } finally { reader.releaseLock(); }
}
