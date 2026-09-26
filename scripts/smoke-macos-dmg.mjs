import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dmg = process.argv[2];
const expectedArch = process.argv[3];
if (process.platform !== 'darwin') throw new Error('The DMG smoke test must run on macOS');
if (!dmg || !['arm64', 'x64'].includes(expectedArch ?? '')) {
  throw new Error('Usage: node scripts/smoke-macos-dmg.mjs <file.dmg> <arm64|x64>');
}

const work = await mkdtemp(join(tmpdir(), 'codexmate-dmg-smoke-'));
const mount = join(work, 'mount');
const app = join(work, 'CodexMate.app');
let mounted = false;
await mkdir(mount);

try {
  execFileSync('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg], { stdio: 'inherit' });
  mounted = true;
  const sourceApp = join(mount, 'CodexMate.app');
  if (!(await stat(sourceApp)).isDirectory()) throw new Error('DMG does not contain CodexMate.app');
  execFileSync('ditto', [sourceApp, app], { stdio: 'inherit' });
  execFileSync('hdiutil', ['detach', mount], { stdio: 'inherit' });
  mounted = false;

  const executable = join(app, 'Contents', 'MacOS', 'CodexMate');
  const architectures = execFileSync('lipo', ['-archs', executable], { encoding: 'utf8' }).trim().split(/\s+/);
  const expectedBinaryArch = expectedArch === 'x64' ? 'x86_64' : 'arm64';
  if (!architectures.includes(expectedBinaryArch)) {
    throw new Error(`Expected ${expectedArch} app binary; found ${architectures.join(', ')}`);
  }

  execFileSync(process.execPath, [join(process.cwd(), 'scripts', 'smoke-desktop.mjs'), executable], { stdio: 'inherit' });
  console.log(JSON.stringify({ dmgMounted: true, appCopied: true, expectedArch, architectures, packagedCodexStarted: true }));
} finally {
  if (mounted) {
    try { execFileSync('hdiutil', ['detach', mount], { stdio: 'inherit' }); } catch {}
  }
  await rm(work, { recursive: true, force: true });
}
