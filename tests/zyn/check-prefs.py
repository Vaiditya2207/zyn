#!/usr/bin/env python3
"""Exercise the real generator in a disposable fixture, never a browser engine."""
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "tools/ffprefs/target"
TARGET.mkdir(exist_ok=True)
CARGO = shutil.which("cargo") or str(Path.home() / ".cargo/bin/cargo")

with tempfile.TemporaryDirectory(prefix="zyn-prefs-", dir=TARGET) as directory:
    fixture = Path(directory)
    shutil.copytree(ROOT / "prefs", fixture / "prefs")
    (fixture / "engine/modules/libpref/init").mkdir(parents=True)
    profile = fixture / "engine/browser/app/profile"
    profile.mkdir(parents=True)
    (profile / "firefox.js").write_text('pref("browser.sessionstore.interval", 15000);\n')
    (fixture / ".surfer").mkdir()
    (fixture / ".surfer/dynamicConfig.brand.json").write_text('"release"')

    def generate():
        subprocess.run([
            CARGO, "run", "--offline", "--locked", "--quiet",
            "--manifest-path", str(ROOT / "tools/ffprefs/Cargo.toml"),
            "--", str(fixture),
        ], check=True, cwd=ROOT)
        return (profile / "zen.js").read_text()

    generated = generate()  # serde_yaml parses every YAML file here.
    static_file = fixture / "engine/modules/libpref/init/zen-static-prefs.inc"
    static_with_overlay = static_file.read_text()
    assert (profile / "firefox.js").read_text().rstrip().endswith("#include zen.js")
    values = {}
    for name, value in re.findall(r'pref\("([^"]+)", (.*?)(?:, locked|, sticky)?\);', generated):
        values[name] = value
    required = {
        "zyn.theme.enabled": True,
        "zyn.theme.blur-radius": 20,
        "zyn.theme.low-power": False,
        "zen.urlbar.open-on-new-tab-page": True,
        "zen.urlbar.replace-newtab": False,
        "zen.urlbar.behavior": "float",
        "zen.theme.acrylic-sidebar": True,
        "zen.theme.acrylic-urlbar": True,
        "browser.sessionstore.interval": 60000,
        "dom.ipc.processPrelaunch.fission.number": 1,
        "browser.lowMemoryResponseMask": 3,
        "browser.lowMemoryResponseOnWarn": True,
        "network.http.http2.coalesce-hostnames": False,
        "network.predictor.enable-hover-on-ssl": True,
        "xpinstall.signatures.required": False,
        "datareporting.usage.uploadEnabled": False,
        "nimbus.rollouts.enabled": False,
        "browser.newtabpage.activity-stream.feeds.discoverystreamfeed": False,
        "zyn.tabs.auto-unload-idle": False,
        "zyn.tabs.unload-idle-minutes": 60,
    }
    for name, value in required.items():
        assert values[name] == json.dumps(value), (name, values[name])
    assert "browser.cache.memory.capacity" not in values
    assert "network.http.max-connections" not in values
    (fixture / "prefs/zen/zyn.yaml").unlink()
    generate()
    assert static_file.read_text() == static_with_overlay, "static declarations must be unchanged"
    assert (profile / "firefox.js").read_text().count("#include zen.js") == 1
    print("PASS: YAML parsed; personal defaults emitted last; static output unchanged; include idempotent")
