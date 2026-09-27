import { _electron } from 'playwright';
import { get as httpGet } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

const ownsHome = !process.env.CODEXMATE_HOME;
const home = ownsHome ? await mkdtemp(join(tmpdir(), 'codexmate-desktop-smoke-')) : resolve(process.env.CODEXMATE_HOME);
const codexHome = join(home, 'codex');
await mkdir(codexHome, { recursive: true });
const env = { ...process.env, CODEXMATE_HOME: home, CODEX_HOME: codexHome, CODEXMATE_SMOKE: '1' };
delete env.OPENAI_API_KEY;
delete env.CODEX_API_KEY;
delete env.ELECTRON_RUN_AS_NODE;

function probeHttp(url) {
  return new Promise((resolve) => {
    const request = httpGet(url, { timeout: 3000 }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        resolve({ status: response.statusCode, contentType: response.headers['content-type'], hasRoot: body.includes('id="root"'), hasBundle: body.includes('assets/index-') });
      });
    });
    request.on('timeout', () => request.destroy(new Error('request timed out')));
    request.on('error', (error) => resolve({ error: error.message }));
  });
}

let app;
try {
  app = await _electron.launch({
    ...(process.argv[2] ? { executablePath: resolve(process.argv[2]), args: ['--disable-gpu', '--no-proxy-server'] } : { args: ['.', '--disable-gpu', '--no-proxy-server'] }),
    env,
    timeout: 30000,
  });
  console.log('Desktop smoke: app process launched.');
  app.on('console', (message) => {
    const text = message.text();
    if (text.startsWith('CodexMate ')) console.log(`Desktop smoke: ${text}`);
  });
  const existingWindows = app.windows();
  console.log(`Desktop smoke: existing window count ${existingWindows.length}.`);
  const mainState = await Promise.race([
    app.evaluate(({ app: electronApp, BrowserWindow }) => ({
      ready: electronApp.isReady(),
      windows: BrowserWindow.getAllWindows().map((window) => ({
        title: window.getTitle(),
        url: window.webContents.getURL(),
        loading: window.webContents.isLoading(),
      })),
      listeners: process._getActiveHandles().flatMap((handle) => {
        if (typeof handle.address !== 'function') return [];
        try {
          const address = handle.address();
          return address && typeof address === 'object' ? [{ type: handle.constructor.name, address }] : [];
        } catch {
          return [];
        }
      }),
      serverAddress: (() => {
        const server = process._getActiveHandles().find((handle) => {
          if (handle.constructor.name !== 'Server' || typeof handle.address !== 'function') return false;
          try { return handle.listening && handle.address()?.port; } catch { return false; }
        });
        return server?.address();
      })(),
    })),
    new Promise((resolve) => setTimeout(() => resolve({ error: 'Electron main process diagnostics timed out' }), 5000)),
  ]);
  console.log(`Desktop smoke: main process ${JSON.stringify(mainState)}.`);
  if (mainState.serverAddress?.port) {
    const origin = `http://127.0.0.1:${mainState.serverAddress.port}`;
    console.log(`Desktop smoke: local server probe ${JSON.stringify(await probeHttp(`${origin}/`))}.`);
  }
  let page = existingWindows[0];
  if (!page) page = await app.firstWindow({ timeout: 15000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });
  page.on('requestfailed', (request) => pageErrors.push(`${request.url()}: ${request.failure()?.errorText ?? 'request failed'}`));
  await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
  const pageTitle = await Promise.race([
    page.title(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out reading the desktop window title')), 5000)),
  ]).catch((error) => String(error));
  const initialPage = {
    url: page.url(),
    title: pageTitle,
    body: await page.locator('body').innerText({ timeout: 5000 }).catch((error) => String(error)),
    errors: pageErrors,
  };
  await page.screenshot({ path: 'artifacts/desktop-initial.png' }).catch(() => {});
  console.log(`Desktop smoke: initial page ${JSON.stringify(initialPage)}`);
  try {
    await page.getByRole('heading', { name: '两位 Codex，一个目标。' }).waitFor({ timeout: 10000 });
  } catch (error) {
    const startupLog = await readFile(join(home, 'desktop-smoke.log'), 'utf8').catch(() => '(no main-process startup trace)');
    console.error(`Desktop smoke: main-process startup trace ${JSON.stringify(startupLog)}`);
    throw error;
  }
  console.log('Desktop smoke: main window rendered.');
  await page.screenshot({ path: 'artifacts/desktop-light.png' });
  console.log('Desktop smoke: checking the bundled Codex account endpoint.');
  const result = await page.evaluate(async () => {
    const { token } = await (await fetch('/api/session')).json();
    return (await (await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CodexMate-Token': token },
      body: JSON.stringify({ action: 'account' }),
      signal: AbortSignal.timeout(150000),
    })).json());
  });
  console.log('Desktop smoke: account endpoint returned.');
  const security = await app.evaluate(({ BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration, sandbox: prefs.sandbox };
  });
  console.log(JSON.stringify({ window: true, account: result, security }, null, 2));
  await writeFile('artifacts/desktop-smoke.json', JSON.stringify({ window: true, account: result, security }, null, 2));
  if (result.error) process.exitCode = 1;
} finally {
  if (app) {
    const child = app.process();
    await Promise.race([app.close().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    }
  }
  if (ownsHome) await rm(home, { recursive: true, force: true });
}
