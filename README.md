# Plants vs Zombies Fusion — WebGL (chunked)

`build.data` is 202 MB, over GitHub's 100 MB per-file limit, so it and `build.wasm`
are stored as 15 MB pieces under `chunks/` and reassembled in the browser before the
engine starts.

```
index.html            launcher (generated) - UI + embedded boot code
index.template.html   source template for index.html
boot.js               boot program: fetch -> verify -> createUnityInstance
build.py              regenerates index.html from the template + boot.js
manifest.json         per-file total size, sha256 and ordered part list
build.loader.js       Unity loader (unmodified)
build.framework.js    Unity framework (unmodified)
chunks/data.000..013  build.data   202,021,342 bytes
chunks/wasm.000..002  build.wasm    38,285,315 bytes
```

## Hosting

Set `SOURCE` at the top of `index.html`:

| `SOURCE`     | chunks come from            | notes |
|--------------|-----------------------------|-------|
| `"jsdelivr"` | `cdn.jsdelivr.net`          | default; real CDN, works fine |
| `"raw"`      | `raw.githubusercontent.com` | no CDN, GitHub may rate-limit |
| `"local"`    | same folder as `index.html` | for GitHub Pages |

### jsDelivr does work — with two conditions

jsDelivr serves this 230 MB repo as long as each chunk is requested as its own
file. The `403 Package size exceeded the configured limit of 50 MB` only appears
on a file jsDelivr has not yet pulled from origin; the same URL returns 200 shortly
after. Two things are required to survive that:

1. **Retries must bypass the HTTP cache.** The 403 response is cacheable. With
   `cache: "force-cache"` the browser replays the cached 403 in ~3 ms forever and
   the download can never recover — this is what made loading stall at 16/17
   parts. Retries use `cache: "reload"`.

2. **Every chunk must be size-checked.** The CDN uses chunked transfer encoding and
   sends no `Content-Length`, so a dropped connection arrives as **HTTP 200 with a
   short body**. In one 6-way concurrent test, 6 of 17 chunks came back truncated,
   all with status 200. `boot.js` compares each part against the size in
   `manifest.json` and refetches on mismatch, then SHA-256 verifies both assembled
   files before handing them to Unity.

Concurrency is limited to 3 requests, which measurably reduced truncation.

### Integrity is never skipped

A corrupt download does not fail loudly — it surfaces much later as a wasm
`RuntimeError: function signature mismatch`, because IL2CPP metadata lives inside
`build.data`, so damaged bytes become bad method pointers.

Both assembled files are therefore checksummed before Unity sees them:

- secure context (https, or http://localhost) -> **SHA-256** via `crypto.subtle`
- otherwise -> **CRC32** in plain JS

The fallback matters because `crypto.subtle` does not exist over `file://`
(origin `null`, not a secure context), which is exactly the case where a silent
skip would hide corruption. Expected digests are embedded in `index.html` by
`build.py`, not read from `manifest.json`, since the CDN copy of the manifest can
be stale. If a checksum fails the loader refuses to boot and says to reload.

**Prefer serving over http://localhost or GitHub Pages rather than opening
`index.html` from disk** — SHA-256 is hardware-accelerated and the whole boot is
several seconds faster than the JS CRC32 path (~17s vs ~11s here).

### The boot code is embedded, not fetched

`index.html` contains `boot.js` inline. Do not change this back to fetching it.
jsDelivr caches `@main` URLs for roughly 12 hours, so a fetched `boot.js` keeps
running the previous version long after a push — which is exactly how a fixed
loader can keep producing the old failure. Editing the loader therefore means:

```bash
# edit boot.js, then:
python3 build.py        # regenerates index.html from index.template.html + boot.js
```

If you ever change `manifest.json`, `build.loader.js`, `build.framework.js` or any
chunk, those *are* still fetched from the CDN and will be stale for up to 12h.
Force an update per file:

```
https://purge.jsdelivr.net/gh/hothost59/pvzf-web-eng@main/manifest.json
```

or pin `REPO` to a tag or commit SHA instead of `@main`, which is immutable and
never needs purging.

## Testing locally

```bash
python3 -m http.server 8099 --directory .
```

with `SOURCE = "local"`, then open <http://localhost:8099>.

## Notes

- `boot.js` is injected as source text rather than `<script src>`, because raw.github-
  usercontent.com serves `.js` as `text/plain` with `nosniff` and browsers refuse to
  execute that.
- `about:blank` opened via `window.open` inherits the launcher's origin, which is what
  lets the blob URLs and cross-origin fetches work. If the popup is blocked, the
  launcher offers a "Play in this tab" fallback.
- The build is assembled fully in memory: ~230 MB downloaded, ~1 GB RAM at peak.
  The browser HTTP cache covers later launches.
- Saves live in IndexedDB under the launcher's origin, so moving the launcher to a
  different host starts a fresh save.
