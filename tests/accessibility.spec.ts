import { test, expect } from '@playwright/test';

test('basic keyboard and mobile usability',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();
  await page.goto('http://127.0.0.1:3077/');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);

  // Phase 1 & 3 verification: Verify 4-stage stepper presence and initial active step
  const stepper = page.locator('ol.stage-stepper');
  await expect(stepper).toBeVisible();
  await expect(page.locator('.stage-step[aria-current="step"]')).toContainText('Import');

  await page.keyboard.press('Tab');
  const focused=await page.evaluate(()=>({tag:document.activeElement?.tagName, name:document.activeElement?.getAttribute('aria-label')}));
  expect(['INPUT','BUTTON','A']).toContain(focused.tag);
  await page.getByRole('button',{name:'Try synthetic example'}).focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{name:'Choose what can be shared'})).toBeVisible();

  // Phase 2 & 3 verification: Verify step transitions to Select sources
  await expect(page.locator('.stage-step[aria-current="step"]')).toContainText('Select sources');

  // Verify keyboard check and tinted selection row class
  await page.locator('label.source input').first().focus();await page.keyboard.press('Space');
  await expect(page.locator('label.source input').first()).toBeChecked();
  await expect(page.locator('label.source').first()).toHaveClass(/selected/);

  // Test 320px narrow mobile viewport for overflow resilience
  await page.setViewportSize({width: 320, height: 640});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);

  await context.close();
});
