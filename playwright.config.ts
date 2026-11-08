import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir:'./tests', testMatch:'**/*.spec.ts', workers:1, timeout:60_000, use:{headless:true, launchOptions:process.env.REV_CHROMIUM_PATH ? {executablePath:process.env.REV_CHROMIUM_PATH} : undefined} });
