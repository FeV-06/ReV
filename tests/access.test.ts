import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Run} from '@/lib/contracts';
import {assertRecipientAccess,projectForRecipient} from '@/lib/server/access';

describe('recipient access policy',()=>{
 it('fails closed for unknown or revoked source permissions and mixed derivations',()=>{
  const a=randomUUID(),b=randomUUID(),user=randomUUID();
  const run:Run={id:randomUUID(),recipient:'dev',createdAt:new Date().toISOString(),state:'approved',artifacts:[a,b].map((id,i)=>({id,kind:'slack_message',externalId:String(i),text:`source ${i}`,author:null,timestamp:null,url:null,sourceRef:`source ${i}`})),warnings:[],selectedIds:[a,b],items:[{id:randomUUID(),category:'decision',text:'derived',citations:[],verification:'unverified',excluded:false,needsClarification:false,derivationSourceIds:[a,b]}],mode:'model',revision:1,approvedRevision:1,acceptedPartial:false};
  const policy={userId:user,grants:new Set([a]),revoked:new Set<string>()};
  expect(()=>assertRecipientAccess(run,policy)).toThrow('not authorised');
  const projected=projectForRecipient(run,policy);expect(projected.artifacts.map(x=>x.id)).toEqual([a]);expect(projected.items).toEqual([]);
  policy.grants.add(b);expect(()=>assertRecipientAccess(run,policy)).not.toThrow();policy.revoked.add(b);expect(()=>assertRecipientAccess(run,policy)).toThrow('not authorised');
 });
});
