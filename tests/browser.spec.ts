import { test, expect } from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';

const url = process.env.REV_BROWSER_TEST_URL ?? 'http://127.0.0.1:3077/';

test('registers a local Git project and shows capture is not active',async({page})=>{
 const root=await mkdtemp(path.join(tmpdir(),'rev-dashboard-project-'));execFileSync('git',['init','-q',root]);
 try {
  await page.goto(url);
  await page.locator('#btn-login-superuser-admin').click();
  await expect(page.getByRole('status').filter({hasText:'Connected'})).toContainText('protocol 1');
  await page.getByLabel('Git project root').fill(root);await page.getByLabel('Project GitHub username').fill('FeV-06');
  await page.getByLabel('I authorize ReV to register this directory for future local capture.').check();
  await page.getByRole('button',{name:'Register project'}).click();await expect(page.getByText(root,{exact:true})).toBeVisible();
  await expect(page.getByText('GitHub: @FeV-06 · Capture not implemented')).toBeVisible();
  await page.reload();await expect(page.getByText(root,{exact:true})).toBeVisible();
  page.once('dialog',dialog=>void dialog.accept());await page.getByRole('button',{name:'Remove',exact:true}).click();await expect(page.getByText(root,{exact:true})).toHaveCount(0);
 } finally {await rm(root,{recursive:true,force:true});}
});

test('guided ReV snapshot opens claim categories and exports the selected evidence', async ({ page }) => {
  await page.goto(url);
  await page.locator('#btn-eval-demo-admin').click();
  await page.getByRole('button', { name: 'New Handover Studio' }).click();
  const setup = page.locator('details[data-tour-detail="setup"]');
  if (await setup.getAttribute('open') === null) await setup.locator('summary').click();
  const assign = page.getByRole('button', { name: 'Assign successor', exact: true });
  await expect(assign).toHaveAttribute('data-tour-current', 'info');
  await expect(setup).not.toHaveAttribute('data-tour-current');
  expect(await assign.evaluate(button => parseFloat(getComputedStyle(button).borderTopLeftRadius))).toBeGreaterThan(0);
  await assign.click();
  await page.getByLabel('Successor email').fill('judge-demo@example.invalid');
  const created = page.waitForResponse(response => response.url().endsWith('/api/runs') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Launch Instant Demo Run/ }).click();
  const { run } = await (await created).json();
  try {
    expect(run.successorEmail).toBe('judge-demo@example.invalid');
    const sources = page.locator('label.source');
    await expect(sources).toHaveCount(5);
    await expect(page.locator('.source-list')).not.toContainText(/@[0-9a-f]{40}/);
    await sources.filter({ hasText: 'verify vscode e2e flow' }).locator('input').check();
    await sources.filter({ hasText: 'workspace data leak' }).locator('input').check();
    await page.getByLabel('I confirm the recipient may receive all selected material.').check();
    await page.getByRole('button', { name: 'Generate draft' }).click();
    await expect(page.getByRole('heading', { name: 'Make it yours' })).toBeVisible();
    await page.getByRole('button', { name: 'Select sources', exact: true }).click();
    await expect(sources.locator('input:checked')).toHaveCount(2);
    await page.getByRole('button', { name: 'Return to review' }).click();
    const guide = page.getByRole('complementary', { name: 'Guided demo' });
    await expect(guide).toHaveAttribute('data-review-docked', 'true');
    const risk = page.locator('.review-claim-group').filter({ has: page.locator('.claim-category--risk') });
    await expect(risk.locator('textarea')).toBeHidden();
    await risk.locator('summary').click();
    await expect(risk.locator('textarea')).toBeVisible();
    const verification = page.locator('summary').filter({ hasText: 'Verification Tools' });
    if (!(await page.getByRole('button', { name: 'Inspect Knowledge Graph' }).isVisible())) await verification.click();
    await page.getByRole('button', { name: 'Inspect Knowledge Graph' }).click();
    const riskLink = page.locator('.evidence-link').filter({ hasText: 'workspace data leak' });
    await expect(riskLink).toContainText('From · Source');
    await expect(riskLink).toContainText('To · Claim');
    await expect(riskLink).toContainText('recheck workspace data isolation');
    await expect(page.getByRole('heading', { name: 'Departure interview' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Assign successor' })).toHaveCount(0);
    await page.getByLabel('I confirm the selected sources are authorised for this recipient.').check();
    await page.getByRole('button', { name: 'Approve current revision' }).click();
    await expect(page.getByRole('heading', { name: 'Handover approved & ready' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download Markdown' })).toBeEnabled();
    const markdown = await page.evaluate(async id => (await fetch('/api/runs/' + id + '/export', {
      headers: { 'X-Rev-Request': '1' },
    })).text(), run.id);
    expect(markdown).toContain('cached ReV demo (prewritten draft)');
    expect(markdown).toContain('The claims were prepared in advance');
    expect(markdown).toContain('workspace data leak');
    expect(markdown).not.toContain('tree-sitter ast symbol extraction');
  } finally {
    await page.evaluate(id => fetch('/api/runs/' + id, { method: 'DELETE', headers: { 'X-Rev-Request': '1' } }), run.id);
  }
});

test('gap answer becomes a new unselected source and invalidates approval', async({page})=>{
  await page.goto(url);
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
  expect(result).toEqual({state:'needs_review',selected:1,answer:true,status:400});
});
