import { expect, test } from '@playwright/test';

test('successor chat sends a missing answer through the interview and review', async ({ page }) => {
  await page.goto(process.env.REV_BROWSER_TEST_URL ?? 'http://127.0.0.1:3077/');
  const name = `Interview test ${Date.now()}`;
  const question = 'Who signs the emergency failover authorization?';
  const answer = 'The incident commander signs it.';
  const runId = await page.evaluate(async recipient => {
    const headers = { 'X-Rev-Request': '1', 'Content-Type': 'application/json' };
    async function send(url: string, method: string, body: object) {
      const response = await fetch(url, { method, headers, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return data.run;
    }
    const run = await send('/api/runs', 'POST', { recipient, departingPerson: 'Ari', fixture: true });
    const url = `/api/runs/${run.id}`;
    const selectedIds = [run.artifacts[0].id];
    await send(url, 'PATCH', { action: 'scope', selectedIds });
    await send(url, 'PATCH', { action: 'generate', selectedIds, fixture: true, acceptPartial: false, confirmAuthorisation: true });
    await send(url, 'PATCH', { action: 'approve', confirmAuthorisation: true });
    return run.id as string;
  }, name);

  async function ask() {
    await page.getByLabel('Ask a question').fill(question);
    await page.getByRole('button', { name: 'Ask assistant' }).click();
  }
  async function signOut() {
    await page.getByRole('button', { name: 'Sign out' }).filter({ visible: true }).click();
  }
  async function openAsSuccessor() {
    await page.locator('#btn-login-superuser-dev').click();
    await page.getByRole('heading', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ask your handover assistant' })).toBeVisible();
  }

  try {
    await openAsSuccessor();
    await ask();
    await expect(page.getByText(`Added to the departure interview: ${question}`)).toBeVisible();
    await signOut();
    await page.getByRole('button', { name: /Departing Person/ }).click();
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await expect(page.getByText(question, { exact: true })).toBeVisible();
    await page.getByLabel('Your answer').fill(answer);
    await page.getByRole('button', { name: 'Save interview answer' }).click();
    await expect(page.getByText(answer, { exact: true })).toBeVisible();
    await expect(page.getByLabel('Share this answer when approving the handover')).toHaveCount(0);
    await signOut();
    await page.locator('#btn-login-superuser-admin').click();
    await page.getByRole('button', { name: 'New Handover Studio' }).click();
    await page.locator('.run-row').filter({ hasText: name }).click();
    await expect(page.getByLabel('Your answer')).toHaveCount(0);
    await page.getByLabel('Successor email').fill('alex.vance@team.internal');
    await page.getByRole('button', { name: 'Save successor assignment' }).click();
    await expect(page.getByText('Assigned to alex.vance@team.internal', { exact: true })).toBeVisible();
    await page.getByLabel('Share this answer when approving the handover').check();
    await page.getByLabel('I confirm the selected sources are authorised for this recipient.').check();
    await page.getByRole('button', { name: 'Approve current revision' }).click();
    await expect(page.getByRole('heading', { name: 'Handover approved & ready' })).toBeVisible();
    await signOut();
    await openAsSuccessor();
    await ask();
    const chat = page.getByRole('log', { name: 'Handover conversation' });
    await expect(chat.getByText(answer, { exact: true })).toBeVisible();
    await expect(chat.getByText(/Handover interview answer · Ari/)).toBeVisible();
  } finally {
    await page.evaluate(id => fetch(`/api/runs/${id}`, { method: 'DELETE', headers: { 'X-Rev-Request': '1' } }), runId);
  }
});
