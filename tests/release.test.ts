import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPairSync, createHash, type KeyObject } from 'node:crypto';
import { signRelease, verifyRelease, stageRelease } from '../src/operations/release.js';
import { exec } from '../src/adapters/process.js';

async function keys() {
  const dir = await mkdtemp(join(tmpdir(), 'cm-release-'));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const priv = join(dir, 'priv.pem'), pub = join(dir, 'pub.pem');
  await writeFile(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string);
  await writeFile(pub, publicKey.export({ type: 'spki', format: 'pem' }) as string);
  const pkg = join(dir, 'codexmate-1.1.0.tgz');
  await writeFile(pkg, 'package-bytes');
  return { dir, priv, pub, pkg, publicKey, privateKey, home: await mkdtemp(join(tmpdir(), 'cm-home-')) };
}
// 子命令参数经真实 CLI 解析，避免再次引入与全局 -V/--version 的冲突。
const cli = (args: string[]) => exec(process.execPath, ['--import', 'tsx', 'src/cli/index.ts', ...args], { timeout: 120000 });

test('签名清单与包体积、哈希、签名三者一致才可通过校验', async () => {
  const { dir, pkg, publicKey, privateKey } = await keys();
  const bytes = await readFile(pkg);
  const manifest = await signRelease(pkg, '1.1.0', privateKey as KeyObject);
  assert.equal(manifest.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(manifest.size, bytes.length);
  assert.equal(manifest.schema, 'codexmate.release/v1');
  assert.equal((await verifyRelease(pkg, manifest, publicKey)).version, '1.1.0');
  const tampered = join(dir, 'codexmate-1.1.1.tgz');
  await writeFile(tampered, 'package-bytes-tampered');
  await assert.rejects(() => verifyRelease(tampered, manifest, publicKey), /校验不一致/);
  const sameSize = join(dir, 'codexmate-1.1.2.tgz');
  await writeFile(sameSize, 'Package-bytes');
  await assert.rejects(() => verifyRelease(sameSize, manifest, publicKey), /校验不一致/);
  const other = generateKeyPairSync('ed25519').publicKey;
  await assert.rejects(() => verifyRelease(pkg, manifest, other), /签名无效/);
});

test('release sign 的版本参数不会被全局 --version 抢占，清单必须真正写出', async () => {
  const { dir, priv, pub, pkg, home } = await keys();
  const out = join(dir, 'manifest.json');
  const signed = await cli(['--home', home, 'release', 'sign', pkg, '--release-version', '1.1.0', '--private-key', priv, '--out', out]);
  assert.equal(signed.code, 0, signed.stderr);
  assert.ok(existsSync(out), '签名清单必须写入 --out 指定的路径。');
  assert.equal(JSON.parse(await readFile(out, 'utf8')).version, '1.1.0');
  const verified = await cli(['--home', home, 'release', 'verify', pkg, '--manifest', out, '--public-key', pub]);
  assert.equal(verified.code, 0, verified.stderr);
  assert.match(verified.stdout, /"version": "1\.1\.0"/);
  const staged = await cli(['--home', home, 'release', 'stage', pkg, '--manifest', out, '--public-key', pub]);
  assert.equal(staged.code, 0, staged.stderr);
  assert.match(staged.stdout, /updates/);
});

test('重复生成同一路径清单被拒绝，且程序版本查询不受影响', async () => {
  const { dir, priv, pkg, home } = await keys();
  const out = join(dir, 'manifest.json');
  assert.equal((await cli(['--home', home, 'release', 'sign', pkg, '--release-version', '1.1.0', '--private-key', priv, '--out', out])).code, 0);
  const again = await cli(['--home', home, 'release', 'sign', pkg, '--release-version', '1.1.0', '--private-key', priv, '--out', out]);
  assert.notEqual(again.code, 0);
  assert.match(again.stderr + again.stdout, /清单已存在/);
  const version = await cli(['--version']);
  assert.equal(version.code, 0);
  assert.match(version.stdout.trim(), /^1\.1\.0-rc\.1$/);
});

test('校验失败的更新包不落盘，通过后才暂存并保留回滚路径', async () => {
  const { pkg, pub, home, privateKey } = await keys();
  const manifest = await signRelease(pkg, '1.2.0', privateKey as KeyObject);
  const other = generateKeyPairSync('ed25519').publicKey;
  await assert.rejects(() => stageRelease(pkg, manifest, other, home), /签名无效/);
  assert.equal(existsSync(join(home, 'updates')), false);
  const staged = await stageRelease(pkg, manifest, await readFile(pub, 'utf8'), home);
  assert.match(staged.package, /1\.2\.0/);
  assert.match(staged.next, /回滚/);
});
