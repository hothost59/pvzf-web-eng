#!/usr/bin/env python3
"""Regenerate index.html from index.template.html + boot.js.

boot.js is embedded rather than fetched: the launcher is the only file that must
be up to date, and jsDelivr caches @branch URLs for ~12h, so a fetched boot.js
would keep running the previous version long after a push.
"""
import json, pathlib
d = pathlib.Path(__file__).parent
boot = (d / "boot.js").read_text()
assert "</script" not in boot, "boot.js contains </script>, cannot embed"
tpl = (d / "index.template.html").read_text()
man = json.loads((d / "manifest.json").read_text())
digests = {"build." + k: {"sha256": v["sha256"], "crc32": v["crc32"]}
           for k, v in man["files"].items()}
out = tpl.replace("/*__BOOT_SRC__*/null", "const BOOT_SRC = " + json.dumps(boot) + ";")
assert out != tpl, "placeholder /*__BOOT_SRC__*/null not found in template"
out2 = out.replace("/*__DIGESTS__*/null", "const DIGESTS = " + json.dumps(digests) + ";")
assert out2 != out, "placeholder /*__DIGESTS__*/null not found in template"
out = out2
(d / "index.html").write_text(out)
print("index.html regenerated (%d bytes, boot.js embedded: %d bytes)" % (len(out), len(boot)))
