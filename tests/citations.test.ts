import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {attachVerifiedCitations} from '@/lib/server/citations';
import type {Run} from '@/lib/contracts';
const sourceId=randomUUID(),itemId=randomUUID();
function run():Run {return {id:randomUUID(),recipient:'dev',createdAt:new Date().toISOString(),state:'needs_review',artifacts:[{id:sourceId,kind:'slack_message',externalId:'x',text:'Olá Redis is used',author:null,timestamp:null,url:null,sourceRef:'source'}],warnings:[],selectedIds:[sourceId],items:[{id:itemId,category:'decision',text:'Use Redis',citations:[],verification:'unverified',excluded:false,needsClarification:false,derivationSourceIds:[sourceId]}],mode:'model',revision:1,approvedRevision:null,acceptedPartial:false};}
describe('human citation repair',()=>{
 it('uses exact UTF-8 byte spans and keeps selected provenance',()=>{const item=attachVerifiedCitations(run(),itemId,[{sourceId,quote:'Redis'}]);expect(item.citations[0].startByte).toBe(5);expect(item.citations[0].endByte).toBe(10);expect(item.verification).toBe('validated_reference');expect(item.derivationSourceIds).toEqual([sourceId]);});
 it('rejects fabricated quotes and unselected sources',()=>{expect(()=>attachVerifiedCitations(run(),itemId,[{sourceId,quote:'missing'}])).toThrow('not found');const r=run();r.selectedIds=[];expect(()=>attachVerifiedCitations(r,itemId,[{sourceId,quote:'Redis'}])).toThrow('not selected');});
});
