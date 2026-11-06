#!/usr/bin/env python3
"""check_zen_translations must reject an omni.ja without Zen's Fluent files
and accept one that has them. Uses synthetic archives; no browser needed."""
import importlib.util, pathlib, sys, tempfile, zipfile

root = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('zyn_state', root / 'scripts/zyn-state.py')
state = importlib.util.module_from_spec(spec)
spec.loader.exec_module(state)

needed = state.zen_translations()
assert 'localization/en-US/browser/zen-general.ftl' in needed, needed

with tempfile.TemporaryDirectory() as d:
    bad = pathlib.Path(d, 'bad.ja')
    with zipfile.ZipFile(bad, 'w') as z:
        z.writestr('localization/en-US/browser/browserSets.ftl', 'tab-new-shortcut =\n    .key = T\n')
    try:
        state.check_zen_translations(bad)
    except SystemExit as e:
        assert 'zen-general.ftl' in str(e), e
    else:
        sys.exit('FAIL: archive without Zen translations was accepted')

    good = pathlib.Path(d, 'good.ja')
    with zipfile.ZipFile(good, 'w') as z:
        for n in needed:
            z.writestr(n, '')
    state.check_zen_translations(good)

print(f'PASS: {len(needed)} Zen translation files required in packages')
