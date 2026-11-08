import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { artifactSchema, citationSchema, itemSchema, importSchema, draftSchema, runSchema, modelResponseSchema, graphEdgeSchema, graphEventSchema, gapSchema } from '../src/lib/contracts.ts';
const definitions={artifact:artifactSchema,citation:citationSchema,item:itemSchema,importResult:importSchema,draft:draftSchema,run:runSchema,modelResponse:modelResponseSchema,graphEdge:graphEdgeSchema,graphEvent:graphEventSchema,gap:gapSchema};
const output=JSON.stringify({$schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://rev.local/contracts/domain.v1.json',title:'ReV domain contracts v1',$defs:Object.fromEntries(Object.entries(definitions).map(([name,schema])=>[name,z.toJSONSchema(schema,{target:'draft-2020-12'})]))},null,2)+'\n';
const dest=new URL('../contracts/domain.v1.schema.json',import.meta.url);
if(process.argv.includes('--check')) { const current=await readFile(dest,'utf8');if(current!==output){console.error('Domain schema is stale; run pnpm contracts:generate');process.exitCode=1;}else console.log('Domain schema matches Zod contracts'); }
else { await writeFile(dest,output); console.log('Generated contracts/domain.v1.schema.json'); }
