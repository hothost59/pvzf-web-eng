/* Runs in the launcher's window or the about:blank child.
   Fetches the chunks, verifies them, starts Unity. */
(function () {
  var BASE = window.__PVZ_BASE__ || "./";
  var DIGESTS = window.__PVZ_DIGESTS__ || null;

  var canvas = document.getElementById("unity-canvas");
  var fill = document.getElementById("fill");
  var msg = document.getElementById("msg");

  function show(frac, text, bad) {
    if (fill) fill.style.width = Math.round(frac * 100) + "%";
    if (msg) { msg.textContent = text || ""; msg.className = bad ? "bad" : ""; }
    try { if (window.__PVZ_PROGRESS__) window.__PVZ_PROGRESS__(frac, text, bad); } catch (e) {}
  }

  function fit() {
    var w = window.innerWidth, h = window.innerHeight;
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    canvas.width = w; canvas.height = h;
  }
  fit(); window.addEventListener("resize", fit);

  /* Retries MUST bypass the HTTP cache. jsDelivr answers 403 ("Package size
     exceeded...") for a file it has not pulled from origin yet, and that error
     response is cacheable - with cache:"force-cache" every retry replays the
     cached 403 in a few ms and the download can never recover. */
  function get(url, type, attempt, fresh) {
    attempt = attempt || 0;
    return fetch(url, { cache: fresh ? "reload" : "force-cache" }).then(function (r) {
      if (!r.ok) {
        var retriable = r.status === 403 || r.status === 429 || r.status >= 500;
        if (retriable && attempt < 8) {
          var wait = Math.min(1000 * Math.pow(2, attempt), 10000);
          return new Promise(function (ok) { setTimeout(ok, wait); })
            .then(function () { return get(url, type, attempt + 1, true); });
        }
        throw new Error(url.split("/").pop() + " -> HTTP " + r.status);
      }
      return type === "text" ? r.text() : r.arrayBuffer();
    });
  }

  var done = 0, totalParts = 1;
  function tick() { show(0.8 * (done / totalParts), "Downloading " + done + " / " + totalParts); }

  /* A chunk can arrive HTTP 200 but short: the CDN uses chunked transfer
     encoding (no Content-Length), so a dropped connection looks like a clean
     small response. Check every part against the manifest and refetch. */
  function fetchPart(part, tries) {
    tries = tries || 0;
    return get(BASE + "chunks/" + part.name, null, 0, tries > 0).then(function (ab) {
      if (ab.byteLength === part.size) return ab;
      if (tries < 5) {
        return new Promise(function (ok) { setTimeout(ok, 800 * (tries + 1)); })
          .then(function () { return fetchPart(part, tries + 1); });
      }
      throw new Error(part.name + " truncated: " + ab.byteLength + " of " + part.size);
    });
  }

  function fetchChunks(spec) {
    var parts = spec.parts, buf = new Uint8Array(spec.total), at = [], off = 0;
    parts.forEach(function (p) { at.push(off); off += p.size; });
    var next = 0, LIMIT = 3;
    function worker() {
      if (next >= parts.length) return Promise.resolve();
      var i = next++;
      return fetchPart(parts[i]).then(function (ab) {
        buf.set(new Uint8Array(ab), at[i]);
        done++; tick();
        return worker();
      });
    }
    var runners = [];
    for (var k = 0; k < Math.min(LIMIT, parts.length); k++) runners.push(worker());
    return Promise.all(runners).then(function () { return buf; });
  }

  function hex(ab) {
    return Array.prototype.map.call(new Uint8Array(ab), function (b) {
      return ("0" + b.toString(16)).slice(-2);
    }).join("");
  }

  var CRC_T = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return ((c ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, "0");
  }

  /* Never skipped. crypto.subtle does not exist over file:// (origin null, not
     a secure context) - exactly where silent corruption would slip through and
     later surface as a wasm "function signature mismatch". */
  function verify(name, buf, want) {
    var expect = (DIGESTS && DIGESTS[name]) || want || {};
    show(0.82, "Verifying " + name);
    if (self.crypto && self.crypto.subtle && expect.sha256) {
      return crypto.subtle.digest("SHA-256", buf).then(function (d) {
        if (hex(d) !== expect.sha256) throw new Error(name + " is corrupt - reload to refetch");
        return buf;
      });
    }
    if (expect.crc32) {
      if (crc32(buf) !== expect.crc32) throw new Error(name + " is corrupt - reload to refetch");
      return Promise.resolve(buf);
    }
    throw new Error("no checksum for " + name + "; refusing to boot");
  }

  show(0.02, "Starting");
  get(BASE + "manifest.json", "text").then(function (t) {
    var man = JSON.parse(t);
    totalParts = man.files.data.parts.length + man.files.wasm.parts.length;
    tick();
    return Promise.all([
      fetchChunks(man.files.data).then(function (b) { return verify("build.data", b, man.files.data); }),
      fetchChunks(man.files.wasm).then(function (b) { return verify("build.wasm", b, man.files.wasm); }),
      get(BASE + "build.loader.js", "text"),
      get(BASE + "build.framework.js", "text")
    ]);
  }).then(function (r) {
    show(0.85, "Starting engine");
    var dataUrl = URL.createObjectURL(new Blob([r[0]], { type: "application/octet-stream" }));
    var codeUrl = URL.createObjectURL(new Blob([r[1]], { type: "application/wasm" }));
    var fwUrl = URL.createObjectURL(new Blob([r[3]], { type: "text/javascript" }));

    var s = document.createElement("script");
    s.textContent = r[2];
    document.head.appendChild(s);

    return createUnityInstance(canvas, {
      dataUrl: dataUrl, frameworkUrl: fwUrl, codeUrl: codeUrl,
      streamingAssetsUrl: "StreamingAssets",
      companyName: "LanPiaoPiao", productName: "PlantsVsZombiesRH", productVersion: "1.0",
      matchWebGLToCanvasSize: true
    }, function (p) { show(0.85 + p * 0.15, "Loading"); })
    .then(function () {
      show(1, "");
      var bar = document.getElementById("bar");
      if (bar) bar.remove();
      if (msg) msg.remove();
      URL.revokeObjectURL(dataUrl); URL.revokeObjectURL(codeUrl); URL.revokeObjectURL(fwUrl);
      fit();
    });
  }).catch(function (e) {
    show(0, (e && e.message) ? e.message : String(e), true);
    console.error(e);
  });
})();
