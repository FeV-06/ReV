import { test, expect } from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';

test('registers a local Git project and shows capture is not active',async({page})=>{
 const root=await mkdtemp(path.join(tmpdir(),'rev-dashboard-project-'));execFileSync('git',['init','-q',root]);
 try {
  await page.goto('http://127.0.0.1:3077/');await expect(page.getByText('Connected · protocol 1')).toBeVisible();
  await page.getByLabel('Git project root').fill(root);await page.getByLabel('Project GitHub username').fill('FeV-06');
  await page.getByLabel('I authorize ReV to register this directory for future local capture.').check();
  await page.getByRole('button',{name:'Register project'}).click();await expect(page.getByText(root,{exact:true})).toBeVisible();
  await expect(page.getByText('GitHub: @FeV-06 · Capture not implemented')).toBeVisible();
  await page.reload();await expect(page.getByText(root,{exact:true})).toBeVisible();
  page.once('dialog',dialog=>void dialog.accept());await page.getByRole('button',{name:'Remove project'}).click();await expect(page.getByText(root,{exact:true})).toHaveCount(0);
 } finally {await rm(root,{recursive:true,force:true});}
});

test('synthetic source selection, review, approval and scoped export', async ({page}) => {
  await page.goto('http://127.0.0.1:3077/');
  await page.getByLabel('Contributor GitHub username optional · without @').fill('MAYA');
  await page.getByLabel('Target role optional').fill('Platform engineer');
  await page.getByRole('button', {name:'Try synthetic example'}).click();
  await expect(page.getByLabel('What are you taking over?')).toHaveValue('');
  const sources=page.locator('label.source'); await expect(sources).toHaveCount(9);
  await expect(page.getByText('GitHub-linked contributor match: @maya')).toHaveCount(4);
  await expect(sources.filter({hasText:'Document cache recovery procedure'}).getByText('GitHub-linked contributor match', {exact:false})).toHaveCount(0);
  await sources.filter({hasText:'Add Redis session cache and fallback'}).locator('input').check();
  await sources.filter({hasText:'Decision: use Redis for sessions. The fallback still needs tests.'}).locator('input').check();
  await page.getByLabel('I confirm the recipient may receive all selected material.').check();
  await page.getByRole('button', {name:'Generate draft'}).click();
  await expect(page.getByRole('heading',{name:'Make it yours'})).toBeVisible();
  await expect(page.locator('.review-item')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Start here' })).toBeVisible();
  await expect(page.locator('.notice').filter({hasText:'Start here'})).toContainText('Add a test for the Redis session fallback.');
  const graphResult=await page.evaluate(async()=>{
    const headers={'X-Rev-Request':'1','Content-Type':'application/json'};
    const list=await (await fetch('/api/runs',{headers})).json();const id=list.runs[0].id;
    const graph=await (await fetch(`/api/runs/${id}/graph`,{headers})).json();
    const edge=graph.graph.edges[0];
    const reviewed=await fetch(`/api/runs/${id}`,{method:'PATCH',headers,body:JSON.stringify({action:'graph_review',edgeId:edge.id,decision:'confirmed'})});
    return {id,edges:graph.graph.edges.length,status:reviewed.status};
  });
  expect(graphResult.edges).toBeGreaterThan(0);expect(graphResult.status).toBe(200);
  await page.locator('.review-item').nth(0).getByLabel('Exclude').check();
  await page.getByRole('button',{name:'Save review'}).click();
  await expect(page.getByRole('button',{name:'Approve current revision'})).toBeDisabled();
  await page.getByLabel('I confirm the selected sources are authorised for this recipient.').check();
  await page.getByRole('button',{name:'Approve current revision'}).click();
  await expect(page.getByRole('button',{name:'Download Markdown'})).toBeEnabled();
  const run=await page.evaluate(async()=>{ const list=await (await fetch('/api/runs',{headers:{'X-Rev-Request':'1'}})).json(); return list.runs[0]; });
  const output=await page.evaluate(async(id)=>await (await fetch(`/api/runs/${id}/export`,{headers:{'X-Rev-Request':'1'}})).text(),run.id);
  expect(output).toContain('Decision: use Redis for sessions');
  expect(output).toContain('Contributor: MAYA');expect(output).toContain('Target role: Platform engineer');
  expect(output).not.toContain('RESTRICTED_FIXTURE');
  expect(output).not.toContain('Add Redis session cache and fallback');
  await page.reload();
  await expect(page.getByRole('button',{name:/Incoming engineer.*approved/}).first()).toBeVisible();
  await page.getByRole('button',{name:/Incoming engineer.*approved/}).first().click();
  await expect(page.getByText('Contributor: @MAYA')).toBeVisible();await expect(page.getByText('Target role: Platform engineer')).toBeVisible();
  await expect(page.getByRole('button',{name:'Download Markdown'})).toBeEnabled();
  await sources.filter({hasText:'Decision: use Redis for sessions. The fallback still needs tests.'}).locator('input').uncheck();
  await expect(page.getByRole('heading',{name:'Make it yours'})).toHaveCount(0);
  await expect.poll(()=>page.evaluate(async(id)=>(await fetch(`/api/runs/${id}/export`,{headers:{'X-Rev-Request':'1'}})).status,run.id)).toBe(400);
  const cross=await page.request.get('http://127.0.0.1:3077/api/runs',{headers:{origin:'https://evil.example','X-Rev-Request':'1'}}); expect(cross.status()).toBe(403);
});

test('gap answer becomes a new unselected source and invalidates approval', async({page})=>{
  await page.goto('http://127.0.0.1:3077/');
  const result=await page.evaluate(async()=>{
    const headers={'X-Rev-Request':'1','Content-Type':'application/json'};
    async function call(id:string,body:object){const r=await fetch(`/api/runs/${id}`,{method:'PATCH',headers,body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error);return data.run;}
    let run=(await (await fetch('/api/runs',{method:'POST',headers,body:JSON.stringify({recipient:'Gap test',fixture:true})})).json()).run;
    const selectedIds=[run.artifacts[0].id];run=await call(run.id,{action:'scope',selectedIds});run=await call(run.id,{action:'generate',selectedIds,acceptPartial:false,confirmAuthorisation:true,fixture:true});
    run=await call(run.id,{action:'save',items:run.items.map((item:object)=>({...item,needsClarification:true}))});run=await call(run.id,{action:'detect_gaps'});run=await call(run.id,{action:'approve',confirmAuthorisation:true});
    const gapId=run.gaps[0].id;run=await call(run.id,{action:'answer_gap',gapId,answer:'Ari owns cache recovery.',selectedIds});
    const response=await fetch(`/api/runs/${run.id}/export`,{headers});
    return {state:run.state,selected:run.selectedIds.length,answer:run.artifacts.some((a:{kind:string;text:string})=>a.kind==='review_answer'&&a.text==='Ari owns cache recovery.'),status:response.status};
  });
  expect(result).toEqual({state:'awaiting_scope_confirmation',selected:0,answer:true,status:400});
});
