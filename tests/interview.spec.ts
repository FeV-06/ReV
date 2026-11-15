import { expect, test } from '@playwright/test';

test('successor assistant sends missing questions to the departing profile and reads approved replies', async ({ page }) => {
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
    const run = await send('/api/runs', 'POST', { recipient, departingPerson: 'FeV06', fixture: true, revDemo: true });
    const url = `/api/runs/${run.id}`;
    const selectedIds = run.artifacts.map((source: { id: string }) => source.id);
    await send(url, 'PATCH', { action: 'scope', selectedIds });
    await send(url, 'PATCH', { action: 'generate', selectedIds, fixture: true, acceptPartial: false, confirmAuthorisation: true });
    await send(url, 'PATCH', { action: 'approve', confirmAuthorisation: true });
    return run.id as string;
  }, name);

  async function ask(text: string) {
    await page.getByLabel('Ask a question').fill(text);
    await page.getByRole('button', { name: 'Ask assistant' }).click();
  }
  async function signOut() {
    await page.getByRole('button', { name: 'Sign out', exact: true }).filter({ visible: true }).click();
  }
  async function openAsSuccessor() {
    await page.locator('#btn-eval-demo-dev').click();
    await expect(page.getByRole('button', { name: 'AI Assistant', exact: true })).toHaveCount(0);
    await page.getByRole('heading', { name, exact: true }).click();
    await page.getByRole('navigation', { name: 'Handover views' }).getByRole('button', { name: 'AI Assistant' }).click();
    await expect(page.getByLabel('Ask a question')).toBeFocused();
  }

  try {
    await openAsSuccessor();
    await ask('What is Laya used for?');
    await expect(page.getByRole('log').getByText(/keep routine edits out of the draft/)).toBeVisible();
    await ask(question);
    await expect(page.getByText('Added to the departure interview: ' + question)).toBeVisible();
    await signOut();

    const departingProfile = page.getByRole('button', { name: 'Departing Teammate Profile', exact: true });
    await expect(departingProfile).toHaveCSS('background-color', 'rgb(39, 96, 168)');
    await departingProfile.click();
    await expect(page.getByRole('button', { name: new RegExp(name) })).toHaveCount(0);
    await page.getByLabel('Contributor profile').selectOption('FeV06');
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await expect(page.getByText(question, { exact: true })).toBeVisible();
    await page.getByLabel(/Your answer to question/).fill(answer);
    await page.getByRole('button', { name: 'Save interview answer' }).click();
    await expect(page.getByText(answer, { exact: true })).toBeVisible();
    await signOut();

    await page.locator('#btn-eval-demo-admin').click();
    await page.getByRole('tab', { name: 'Questions' }).click();
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await expect(page.getByRole('button', { name: 'Prepare interview questions' })).toHaveCount(0);
    await page.getByLabel('Share this answer when approving the handover').check();
    await page.getByRole('button', { name: 'Approve and share selected replies' }).click();
    await expect(page.getByText('Shared', { exact: true })).toBeVisible();
    await signOut();

    await openAsSuccessor();
    await ask(question);
    const chat = page.getByRole('log', { name: 'Handover conversation' });
    await expect(chat.getByText(answer, { exact: true })).toBeVisible();
    await expect(chat.getByText(/Handover interview answer · FeV06/)).toBeVisible();
  } finally {
    await page.evaluate(id => fetch(`/api/runs/${id}`, { method: 'DELETE', headers: { 'X-Rev-Request': '1' } }), runId);
  }
});
