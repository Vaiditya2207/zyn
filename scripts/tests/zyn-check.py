#!/usr/bin/env python3
"""Configuration-only validation against installed Surfer; no mach or browser runs."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess

root = Path(__file__).resolve().parents[2]
os.chdir(root)
env = os.environ.copy()
for key in ('ZYN_RELEASE', 'ZYN_PGO', 'ZEN_RELEASE', 'AUTOCLOBBER', 'SCCACHE_GHA_ENABLED',
            'CFLAGS', 'CXXFLAGS', 'RUSTFLAGS', 'LDFLAGS', 'ZEN_PERSONAL_BUILD', 'SURFER_COMPAT',
            'ZEN_CROSS_COMPILING'):
    env.pop(key, None)
env['ZYN_BUILD'] = '1'
for mode in ('dev', 'release', 'pgo'):
    current = env.copy()
    if mode != 'dev': current['ZYN_RELEASE'] = '1'
    if mode == 'pgo': current['ZYN_PGO'] = '1'
    out = subprocess.check_output(['node', 'scripts/tests/zyn-config.cjs'], env=current, text=True)
    fixture = Path(out.splitlines()[0].split('=', 1)[1])
    # Run the real adapter's prepare command too, against this private fake engine.
    (fixture / 'scripts').mkdir()
    for script in ('zyn-surfer.cjs', 'zyn-brand.cjs'):
        shutil.copy(root / 'scripts' / script, fixture / 'scripts' / script)
    adapter_env = current.copy()
    if 'ZYN_TEST_SURFER' in current:
        adapter_env['NODE_PATH'] = str(Path(current['ZYN_TEST_SURFER']).parents[1])
    else:
        adapter_env['NODE_PATH'] = str(root / 'node_modules')
    prepared = subprocess.check_output(['node', 'scripts/zyn-surfer.cjs', 'prepare'],
                                       cwd=fixture, env=adapter_env, text=True)
    assert 'profile=zen; channel=zyn' in prepared
    current['topsrcdir'] = str(fixture / 'engine')
    shell = '''
ac_add_options() { for opt; do printf 'AC %s\\n' "$opt"; done; }
mk_add_options() { printf 'MK %s\\n' "$*"; }
. "$topsrcdir/mozconfig"
printf 'ENV CFLAGS=%s\\nENV CXXFLAGS=%s\\nENV RUSTFLAGS=%s\\nENV LDFLAGS=%s\\nENV MOZ_LTO=%s\\nENV MOZ_APP_REMOTINGNAME=%s\\nENV SCCACHE_DIR=%s\\nENV SCCACHE_CACHE_SIZE=%s\\n' "$CFLAGS" "$CXXFLAGS" "$RUSTFLAGS" "$LDFLAGS" "$MOZ_LTO" "$MOZ_APP_REMOTINGNAME" "$SCCACHE_DIR" "$SCCACHE_CACHE_SIZE"
'''
    resolved = subprocess.check_output(['/bin/sh', '-c', shell], env=current, text=True)
    (root / f'.surfer/validation/options-{mode}.txt').write_text(resolved)
    assert (fixture / 'engine/browser/config/version.txt').read_text() == json.loads((root / 'surfer.json').read_text())['brands']['release']['release']['displayVersion'] + '-zyn'
    assert 'AC --with-branding=browser/branding/zyn' in resolved
    assert 'ENV MOZ_APP_REMOTINGNAME=zyn' in resolved
    assert 'AUTOCLOBBER' not in resolved
    assert ('AC MOZ_PGO=1' in resolved) == (mode == 'pgo')
    assert ('AC --enable-lto=cross,thin' in resolved) == (mode != 'dev')
    assert f'MK MOZ_OBJDIR=@TOPSRCDIR@/obj-zyn-{mode}' in resolved
    if mode != 'dev':
        for option in ('--disable-tests', '--disable-rust-tests', '--disable-debug-symbols',
                       '--disable-crashreporter', '--disable-updater', '--disable-geckodriver',
                       '--enable-release', '--enable-optimize', '--enable-rust-simd'):
            assert 'AC ' + option in resolved
        assert 'ENV LDFLAGS= -Wl,--threads=1,--thinlto-jobs=1' in resolved
    print(f'{mode}: actual Surfer generation + sh option evaluation passed')

# Exercise fail-closed classification without fetching, rebasing, or creating commits.
spec = importlib.util.spec_from_file_location('zyn_state', root / 'scripts/zyn-state.py')
state = importlib.util.module_from_spec(spec)
spec.loader.exec_module(state)
meta = json.loads((root / 'surfer.json').read_text())
for changes, expected in [('', 'no-change'), ('M\tsrc/zen/test.mjs', 'ui'), ('M\tsrc/zen/native.cpp', 'incremental'),
                          ('M\tconfigs/zyn/mozconfig', 'full'), ('M\tpackage-lock.json', 'full'),
                          ('M\tsrc/toolkit/moz-configure.patch', 'reconcile-import'),
                          ('D\tsrc/zen/test.mjs', 'reconcile-import')]:
    state.git = lambda *args: json.dumps(meta) if args[0] == 'show' else changes
    assert state.classify('old', 'new') == expected
newmeta = dict(meta, version=dict(meta['version'], version='160.0'))
state.git = lambda *args: json.dumps(meta if args[-1].startswith('old:') else newmeta)
assert state.classify('old', 'new') == 'engine-change'
print('update gates: UI/native/full/patch deletion/engine version cases passed')
for script in (root / 'scripts').glob('zyn-*.sh'):
    subprocess.run(['bash', '-n', str(script)], check=True)
for script in (root / 'scripts').glob('zyn-*.cjs'):
    subprocess.run(['node', '--check', str(script)], check=True)
print('shell/JavaScript syntax checks passed')
