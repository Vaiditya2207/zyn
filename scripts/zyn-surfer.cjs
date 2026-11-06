#!/usr/bin/env node
// Small, version-checked adapter: keep upstream surfer.json and installed Surfer intact.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
if (fs.realpathSync(process.cwd()) !== fs.realpathSync(root)) {
  throw new Error('Run from the Zyn checkout root');
}
const command = process.argv[2];
if (!['build', 'import', 'prepare'].includes(command)) {
  throw new Error('Usage: node scripts/zyn-surfer.cjs prepare|import|build [--ui]');
}
if (process.env.ZEN_RELEASE || process.env.AUTOCLOBBER || process.env.SCCACHE_GHA_ENABLED) {
  throw new Error('Unset ZEN_RELEASE, AUTOCLOBBER and SCCACHE_GHA_ENABLED for the personal build');
}
if (process.env.ZEN_CROSS_COMPILING || process.env.SURFER_COMPAT ||
    (process.env.SURFER_PLATFORM && process.env.SURFER_PLATFORM !== 'darwin')) {
  throw new Error('Zyn uses the native macOS arm64 lane, without cross/compat overrides');
}
if (process.env.ZYN_PGO === '1' && process.env.ZYN_RELEASE !== '1') {
  throw new Error('ZYN_PGO=1 requires ZYN_RELEASE=1');
}
if (process.env.ZYN_PGO === '1' && process.argv.includes('--ui')) {
  throw new Error('PGO requires a complete build, not build:ui');
}
const engine = path.join(root, 'engine');
if (!fs.existsSync(engine) || fs.realpathSync(engine) !== engine) {
  throw new Error('Provide a private engine directory here; do not symlink another checkout');
}
if (fs.existsSync(path.join(root, 'mozconfig')) || process.env.MOZ_OBJDIR) {
  throw new Error('Remove/reconcile the root mozconfig or MOZ_OBJDIR override; Zyn owns its build lanes');
}
process.env.MOZCONFIG = path.join(engine, 'mozconfig');
const surfer = path.dirname(require.resolve('@zen-browser/surfer/package.json'));
if (require(path.join(surfer, 'package.json')).version !== '1.14.9') {
  throw new Error('Surfer adapter reviewed for 1.14.9 only; review before upgrading');
}
process.env.ZYN_BUILD = '1';
// Loaded before the CLI; its utils and commands share this same mutable object.
const { config } = require(path.join(surfer, 'dist/utils/config.js'));
if (config.version.candidate && config.version.candidate !== config.version.version) {
  throw new Error('Firefox candidate/release pins differ; review the engine selection before building Zyn');
}
require('./zyn-brand.cjs')(config);
const dynamic = require(path.join(surfer, 'dist/utils/dynamic-config.js'));
dynamic.set('brand', 'zyn');
dynamic.set('buildMode', process.env.ZYN_RELEASE === '1' ? 'release' : 'dev');
if (command === 'prepare') {
  console.log(`Zyn ${config.brands.zyn.release.displayVersion}; profile=zen; channel=zyn`);
} else {
  require(path.join(surfer, 'dist/index.js'));
}
