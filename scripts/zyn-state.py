#!/usr/bin/env python3
"""Fail-closed local build receipts and package identity checks; no profile reads."""
import configparser
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT).decode().strip()


def source_files():
    result = {}
    for name in git('ls-files').splitlines():
        p = ROOT / name
        if p.is_symlink():
            value = b'link:' + os.readlink(p).encode()
        elif p.is_file():
            value = p.read_bytes()
        else:
            value = b'<deleted>'
        result[name] = hashlib.sha256(value).hexdigest()
    return result


def fingerprint():
    # Include uncommitted tracked content as well as the commit, and build switches.
    digest = hashlib.sha256(json.dumps(source_files(), sort_keys=True).encode()).hexdigest()
    return {'commit': git('rev-parse', 'HEAD'), 'source_sha256': digest,
            'release': os.environ.get('ZYN_RELEASE', '0'),
            'pgo': os.environ.get('ZYN_PGO', '0'),
            'flags': {k: os.environ.get(k, '') for k in
                      ('CFLAGS', 'CXXFLAGS', 'RUSTFLAGS', 'LDFLAGS', 'CC', 'CXX', 'RUSTC', 'CARGO')}}


def version():
    return json.loads((ROOT / 'surfer.json').read_text())['brands']['release']['release']['displayVersion'] + '-zyn'


def check_ini(path):
    ini = configparser.ConfigParser(interpolation=None)
    ini.read(path)
    for key, expected in {'Profile': 'zen', 'Name': 'Zen', 'RemotingName': 'zyn', 'Version': version()}.items():
        if ini.get('App', key, fallback=None) != expected:
            raise SystemExit(f'Wrong {key} in {path}; expected {expected}')


def build_state(obj):
    check_ini(obj / 'dist/bin/application.ini')
    result = fingerprint()
    result['files'] = source_files()
    for name, path in {'mozconfig': ROOT / 'engine/mozconfig',
                       'autoconf': obj / 'config/autoconf.mk',
                       'application': obj / 'dist/bin/application.ini'}.items():
        result[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def lane():
    suffix = 'dev'
    if os.environ.get('ZYN_RELEASE') == '1':
        suffix = 'pgo' if os.environ.get('ZYN_PGO') == '1' else 'release'
    return ROOT / 'engine' / ('obj-zyn-' + suffix)


def verify_ui():
    receipt = json.loads((lane() / 'zyn-build.json').read_text())
    now = fingerprint()
    if any(receipt[key] != now[key] for key in ('release', 'pgo', 'flags')):
        raise SystemExit('Build settings changed; run a native build')
    previous, current = receipt['files'], source_files()
    names = [p for p in previous.keys() | current.keys() if previous.get(p) != current.get(p)]
    # Also forbid deleted overlays and unknown untracked inputs.
    deleted = any(p not in current or not (ROOT / p).exists() for p in previous)
    untracked = git('ls-files', '--others', '--exclude-standard')
    if deleted or untracked or not all(p.startswith('src/') and p.endswith(('.js', '.mjs', '.css', '.ftl')) for p in names):
        raise SystemExit('Changes are not proven UI-only; import and run a native build')


def verify_import():
    engine = ROOT / 'engine'
    config = (engine / 'toolkit/moz.configure').read_text()
    if not re.search(r'"MOZ_APP_PROFILE",\s*default="zen"', config):
        raise SystemExit('Imported engine does not retain MOZ_APP_PROFILE=zen')
    branding = (engine / 'browser/branding/zyn/configure.sh').read_text()
    if 'MOZ_APP_DISPLAYNAME="Zyn"' not in branding or 'MOZ_MACBUNDLE_ID="browser"' not in branding:
        raise SystemExit('Import the Zyn branding before building')
    # Surfer catches some copy errors. Verify every non-patch source overlay.
    for source in (ROOT / 'src').rglob('*'):
        if not source.is_file() or source.suffix == '.patch' or 'node_modules' in source.parts:
            continue
        dest = engine / source.relative_to(ROOT / 'src')
        if not dest.is_symlink() or dest.resolve() != source.resolve():
            raise SystemExit(f'Missing/stale imported overlay: {dest}')
    if not (engine / 'browser/app/profile/zen.js').is_file():
        raise SystemExit('Missing generated Zen preferences')
    if not (engine / 'browser/locales/en-US/browser/zen-general.ftl').is_file():
        raise SystemExit('Missing Zen translations; run python3 scripts/copy_language_pack.py en-US')


def zen_translations():
    """Zen's own en-US Fluent files, as they must appear in browser/omni.ja."""
    base = ROOT / 'locales/en-US/browser/browser'
    return sorted('localization/en-US/browser/' + p.relative_to(base).as_posix()
                  for p in base.rglob('*.ftl'))


def check_zen_translations(omni):
    """Fail if any Zen Fluent file is missing. Fluent drops the whole en-US
    bundle when one linked file is missing, which removes every <key> letter
    (Cmd+T, Cmd+W, ...) and many labels."""
    with zipfile.ZipFile(omni) as z:
        names = set(z.namelist())
    missing = [n for n in zen_translations() if n not in names]
    if missing:
        raise SystemExit(f'Package is missing Zen translations: {", ".join(missing)}')


def verify_app(folder):
    apps = list(folder.glob('**/Zyn.app'))
    if len(apps) != 1:
        raise SystemExit('Expected exactly one packaged Zyn.app')
    app = apps[0].resolve()
    with (app / 'Contents/Info.plist').open('rb') as f:
        plist = plistlib.load(f)
    for key, value in {'CFBundleIdentifier': 'app.zyn.browser', 'CFBundleName': 'Zyn',
                       'CFBundleExecutable': 'zen'}.items():
        if plist.get(key) != value:
            raise SystemExit(f'Wrong bundle identity {key}: {plist.get(key)}')
    check_ini(app / 'Contents/Resources/application.ini')
    check_zen_translations(app / 'Contents/Resources/browser/omni.ja')
    if plist.get('CFBundleShortVersionString') != version():
        raise SystemExit('Wrong bundle version')
    built = configparser.ConfigParser(interpolation=None)
    packaged = configparser.ConfigParser(interpolation=None)
    built.read(lane() / 'dist/bin/application.ini')
    packaged.read(app / 'Contents/Resources/application.ini')
    for key in ('BuildID', 'SourceStamp'):
        if not built.has_option('App', key) or built.get('App', key) != packaged.get('App', key, fallback=None):
            raise SystemExit(f'Package {key} differs from the selected build')
    for p in app.rglob('*'):
        if p.is_symlink():
            try:
                p.resolve(strict=True).relative_to(app)
            except (ValueError, OSError):
                raise SystemExit(f'Non-self-contained package symlink: {p}')
    print(app)


def classify(old, new):
    a = json.loads(git('show', f'{old}:surfer.json'))
    b = json.loads(git('show', f'{new}:surfer.json'))
    if a['version'] != b['version']:
        return 'engine-change'
    changes = git('diff', '--name-status', old, new).splitlines()
    if any(line.split('\t')[-1].endswith('.patch') or
           (line.startswith(('D\t', 'R')) and line.split('\t')[-1].startswith('src/'))
           for line in changes):
        return 'reconcile-import'
    names = [line.split('\t')[-1] for line in changes]
    if not names:
        return 'no-change'
    if any(p in ('package.json', 'package-lock.json', 'surfer.json', 'mozconfig') or
           p.startswith(('configs/', 'scripts/', 'common/', 'tools/')) for p in names):
        return 'full'
    if names and all(p.startswith('src/') and p.endswith(('.js', '.mjs', '.css', '.ftl')) for p in names):
        return 'ui'
    return 'incremental'


if __name__ == '__main__':
    command, *args = sys.argv[1:]
    if command == 'fingerprint':
        print(json.dumps(fingerprint(), sort_keys=True))
    elif command == 'classify':
        print(classify(*args))
    elif command == 'verify-import':
        verify_import()
    elif command == 'verify-ui':
        verify_ui()
    elif command == 'verify-app':
        verify_app(Path(args[0]))
    elif command in ('record-build', 'verify-build'):
        obj = Path(args[0]).resolve()
        receipt = obj / 'zyn-build.json'
        state = build_state(obj)
        if command == 'record-build':
            receipt.write_text(json.dumps(state, indent=2) + '\n')
        elif not receipt.exists() or json.loads(receipt.read_text()) != state:
            raise SystemExit('Missing/stale successful build receipt. Run scripts/zyn-build.sh first.')
    else:
        raise SystemExit('Unknown state command')
