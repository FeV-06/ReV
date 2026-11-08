import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir:'./tests', timeout:60_000, use:{headless:true, launchOptions:{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}} });
