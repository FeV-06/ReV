import { test, expect } from '@playwright/test';

test('basic keyboard and mobile usability',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();
  await page.goto('http://127.0.0.1:3077/');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.keyboard.press('Tab');
  const focused=await page.evaluate(()=>({tag:document.activeElement?.tagName, name:document.activeElement?.getAttribute('aria-label')}));
  expect(['INPUT','BUTTON','A']).toContain(focused.tag);
  await page.getByRole('button',{name:'Try synthetic example'}).focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{name:'Choose what can be shared'})).toBeVisible();
  await page.locator('label.source input').first().focus();await page.keyboard.press('Space');
  await expect(page.locator('label.source input').first()).toBeChecked();
  await context.close();
});
