import { describe, expect, it } from 'vitest';
import { readJsonLimited } from '@/lib/server/body';

describe('bounded JSON request reading',()=>{
  it('reads valid JSON without trusting a content length',async()=>{
    const req=new Request('http://localhost/',{method:'POST',body:'{"a":1}'});
    await expect(readJsonLimited(req,20)).resolves.toEqual({a:1});
  });
  it('rejects a streamed oversized body even without content length',async()=>{
    const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('123456'));controller.close();}});
    const req=new Request('http://localhost/',{method:'POST',body:stream,duplex:'half'} as RequestInit & {duplex:'half'});
    await expect(readJsonLimited(req,5)).rejects.toThrow('size limit');
  });
  it('rejects malformed JSON',async()=>{
    const req=new Request('http://localhost/',{method:'POST',body:'{bad'});
    await expect(readJsonLimited(req,100)).rejects.toThrow('Invalid JSON');
  });
});
