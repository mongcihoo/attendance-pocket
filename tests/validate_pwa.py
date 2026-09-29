#!/usr/bin/env python3
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def png_size(path: Path):
    data = path.read_bytes()[:24]
    assert data[:8] == b"\x89PNG\r\n\x1a\n", f"{path.name} 不是 PNG"
    return struct.unpack(">II", data[16:24])


manifest = json.loads((ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
assert manifest["display"] == "standalone"
assert manifest["start_url"].startswith("./")
assert manifest["scope"] == "./"
assert manifest["icons"], "manifest 缺少图标"

for icon in manifest["icons"]:
    path = ROOT / icon["src"]
    assert path.is_file(), f"缺少 {icon['src']}"
    declared = tuple(map(int, icon["sizes"].split("x")))
    assert png_size(path) == declared, f"{icon['src']} 尺寸不符"

html = (ROOT / "index.html").read_text(encoding="utf-8")
worker = (ROOT / "sw.js").read_text(encoding="utf-8")
app = (ROOT / "app.js").read_text(encoding="utf-8")

required_files = [
    "index.html", "styles.css", "app.js", "manifest.webmanifest", "sw.js",
    "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png",
    "icons/icon-maskable-512.png", "iOS/AttendancePocket.xcodeproj/project.pbxproj",
]
for item in required_files:
    assert (ROOT / item).is_file(), f"缺少 {item}"

for item in ["styles.css?v=7", "app.js?v=7", "manifest.webmanifest", "apple-touch-icon.png"]:
    assert item in html, f"index.html 未引用 {item}"

for item in ["styles.css?v=7", "app.js?v=7", "manifest.webmanifest", "icon-maskable-512.png"]:
    assert item in worker, f"sw.js 未预缓存 {item}"

assert "SKIP_WAITING" in worker and "SKIP_WAITING" in app
assert "updateViaCache:'none'" in app
assert "navigator.canShare" in app and "new File" in app
assert "indexedDB.open" in app
assert "navigator.storage?.persist" in app

print("PASS: manifest、图标、离线资源、更新策略、IndexedDB、文件分享与原生工程均完整")
