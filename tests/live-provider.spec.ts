import { test, expect } from '@playwright/test';
import path from 'node:path';

test.skip(process.env.REV_TEST_LIVE !== '1', 'Opt-in: requires a configured live model provider');
test('real configured provider with synthetic Slack export', async ({page}) => {
  await page.goto('http://127.0.0.1:3077/');
  await page.getByLabel('Who’s leaving?').fill('maya');
  const localGit = page.getByRole('checkbox', {name:/Use local Git history/});
  if (await localGit.isVisible()) await localGit.uncheck();
  await page.getByText('Import from another source', {exact:true}).click();
  await page.getByLabel('Slack export ZIP optional · max 10 MiB').setInputFiles(path.resolve('fixtures/slack-fixture.zip'));
  await page.getByRole('button',{name:'Import sources'}).click();
  const sources=page.locator('label.source'); await expect(sources).toHaveCount(3);
  await sources.filter({hasText:'Decision: use Redis'}).locator('input').check();
  await page.getByLabel('I confirm the recipient may receive all selected material.').check();
  await page.getByLabel(/I consent to sending selected text/).check();
  const generated = page.waitForResponse(response => {
    const request = response.request();
    return request.method() === 'PATCH' && /\/api\/runs\/[^/]+$/.test(new URL(response.url()).pathname) &&
      request.postDataJSON()?.action === 'generate';
  });
  await page.getByRole('button',{name:'Generate draft'}).click();
  const response = await generated;
  expect(response.ok(), response.ok() ? undefined : (await response.json()).error).toBe(true);
  await expect(page.getByRole('heading',{name:'Make it yours'})).toBeVisible({timeout:120000});
  expect(await page.locator('.review-item').count()).toBeGreaterThan(0);
  await page.getByLabel('I confirm the selected sources are authorised for this recipient.').check();
  await page.getByRole('button',{name:'Approve current revision'}).click();
  await expect(page.getByRole('button',{name:'Download Markdown'})).toBeEnabled();
  const run=await page.evaluate(async()=>{ const l=await (await fetch('/api/runs',{headers:{'X-Rev-Request':'1'}})).json();return l.runs[0]; });
  const text=await page.evaluate(async id=>await (await fetch(`/api/runs/${id}/export`,{headers:{'X-Rev-Request':'1'}})).text(),run.id);
  expect(text).toContain('model-generated, human-reviewed'); expect(text).not.toContain('RESTRICTED_FIXTURE');
  console.log('LIVE MODEL E2E: generated',await page.locator('.review-item').count(),'items; restricted fixture absent from export');
});
