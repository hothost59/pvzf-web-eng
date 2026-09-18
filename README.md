# Plants vs Zombies Fusion — WebGL (chunked)

The Unity build is too big for GitHub's 100 MB file limit and jsDelivr's 20 MB/file
CDN limit, so `build.data` and `build.wasm` are stored as 15 MB pieces under
`chunks/` and reassembled in the browser before the engine starts.

```
index.html            launcher: one button, opens the game in a blank tab
boot.js               runs in that tab: fetch -> reassemble -> createUnityInstance
manifest.json         per-file total size, sha256 and ordered part list
build.loader.js       Unity loader (unmodified)
build.framework.js    Unity framework (unmodified)
chunks/data.000..013  build.data   (202,021,342 bytes, sha256 d8122a389ffaf273...)
chunks/wasm.000..002  build.wasm   ( 38,285,315 bytes, sha256 34d038ccc94a6dc7...)
```

## Publishing

1. Create a repo and push this whole folder (no LFS needed — every file is under 20 MB).
2. Open `index.html` and set:

   ```js
   const REPO = "youruser/yourrepo@main";
   const SUBDIR = "";   // e.g. "dist" if the files are in a subfolder
   ```

3. Host `index.html` somewhere that serves it as HTML — **GitHub Pages** is the easy
   option (Settings → Pages → deploy from `main`). jsDelivr serves `.html` as
   `text/plain`, so the launcher cannot run from the CDN itself; only the chunks and
   the JS are fetched from there.

Leaving `REPO` empty makes everything load from the launcher's own folder, which is
how you test locally:

```bash
python3 -m http.server 8099 --directory .
```

## Notes

- The launcher assembles the full build in memory, so first launch downloads ~229 MB
  and needs roughly 1 GB of free RAM. The browser's HTTP cache covers later launches.
- `about:blank` opened via `window.open` inherits the launcher's origin, which is what
  lets the blob URLs and the cross-origin jsDelivr fetches work.
- If the browser blocks the popup, the launcher offers a "Play in this tab" fallback.
- Save data lives in IndexedDB under the launcher's origin, so changing where you host
  the launcher starts a fresh save.
