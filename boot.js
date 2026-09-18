/* Runs inside the about:blank window. Fetches chunks, reassembles, starts Unity. */
(function () {
  var BASE = window.__PVZ_BASE__ || "./";
  var canvas = document.getElementById("unity-canvas");
  var msg = document.getElementById("boot");
  function say(t) { if (msg) msg.textContent = t; }

  function fit() {
    var w = window.innerWidth, h = window.innerHeight;
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    canvas.width = w; canvas.height = h;
  }
  fit(); window.addEventListener("resize", fit);

  /* Retries MUST bypass the HTTP cache. jsDelivr answers 403 ("Package size
     exceeded...") on a file it has not pulled from origin yet, and that error
     response is cacheable - with cache:"force-cache" every retry replays the
     cached 403 in a few ms without hitting the network, so the download can
     never recover. The same applies to a truncated 200. First attempt may use
     the cache (fast relaunches); every retry forces a fresh request. */
  function get(url, type, attempt, fresh) {
    attempt = attempt || 0;
    return fetch(url, { cache: fresh ? "reload" : "force-cache" }).then(function (r) {
      if (!r.ok) {
        var retriable = r.status === 403 || r.status === 429 || r.status >= 500;
        if (retriable && attempt < 8) {
          var wait = Math.min(1000 * Math.pow(2, attempt), 10000);
          say("waiting for CDN on " + url.split("/").pop() + " (HTTP " + r.status + ")");
          return new Promise(function (ok) { setTimeout(ok, wait); })
            .then(function () { return get(url, type, attempt + 1, true); });
        }
        throw new Error(url + " -> HTTP " + r.status);
      }
      return type === "text" ? r.text() : r.arrayBuffer();
    });
  }

  var done = 0, totalParts = 0;
  function tick() { say("downloading " + done + "/" + totalParts + " parts"); }

  /* A chunk can come back HTTP 200 but short: the CDN uses chunked transfer
     encoding (no Content-Length), so a dropped connection looks like a clean
     small response. Every part is checked against the size in the manifest and
     refetched if it does not match, otherwise the build corrupts silently. */
  function fetchPart(part, tries) {
    tries = tries || 0;
    return get(BASE + "chunks/" + part.name, null, 0, tries > 0).then(function (ab) {
      if (ab.byteLength === part.size) return ab;
      if (tries < 5) {
        say("short read on " + part.name + " (" + ab.byteLength + "/" + part.size + "), refetching");
        return new Promise(function (ok) { setTimeout(ok, 800 * (tries + 1)); })
          .then(function () { return fetchPart(part, tries + 1); });
      }
      throw new Error(part.name + " truncated: " + ab.byteLength + " of " + part.size);
    });
  }

  // fetch one file's chunks with limited concurrency, preserving order
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

  /* Final whole-file check. crypto.subtle only exists in a secure context
     (https or localhost), so over plain http or file:// this is skipped and
     the per-part size checks above are what stands. */
  function verify(name, buf, want) {
    if (!self.crypto || !self.crypto.subtle) return Promise.resolve(buf);
    say("verifying " + name);
    return crypto.subtle.digest("SHA-256", buf).then(function (d) {
      var got = hex(d);
      if (got !== want) throw new Error(name + " checksum mismatch: " + got.slice(0, 16) + " != " + want.slice(0, 16));
      return buf;
    });
  }

  say("fetching manifest");
  get(BASE + "manifest.json", "text").then(function (t) {
    var man = JSON.parse(t);
    totalParts = man.files.data.parts.length + man.files.wasm.parts.length;
    tick();
    return Promise.all([
      fetchChunks(man.files.data).then(function (b) { return verify("build.data", b, man.files.data.sha256); }),
      fetchChunks(man.files.wasm).then(function (b) { return verify("build.wasm", b, man.files.wasm.sha256); }),
      get(BASE + "build.loader.js", "text"),
      get(BASE + "build.framework.js", "text")
    ]);
  }).then(function (r) {
    var dataBuf = r[0], wasmBuf = r[1], loaderSrc = r[2], frameworkSrc = r[3];
    say("starting engine");

    var dataUrl = URL.createObjectURL(new Blob([dataBuf], { type: "application/octet-stream" }));
    var codeUrl = URL.createObjectURL(new Blob([wasmBuf], { type: "application/wasm" }));
    var fwUrl   = URL.createObjectURL(new Blob([frameworkSrc], { type: "text/javascript" }));

    // run the Unity loader in this document
    var s = document.createElement("script");
    s.textContent = loaderSrc;
    document.head.appendChild(s);

    return createUnityInstance(canvas, {
      dataUrl: dataUrl,
      frameworkUrl: fwUrl,
      codeUrl: codeUrl,
      streamingAssetsUrl: "StreamingAssets",
      companyName: "LanPiaoPiao",
      productName: "PlantsVsZombiesRH",
      productVersion: "1.0",
      matchWebGLToCanvasSize: true
    }, function (p) { say("loading " + Math.round(p * 100) + "%"); })
    .then(function () {
      if (msg) msg.remove();
      URL.revokeObjectURL(dataUrl); URL.revokeObjectURL(codeUrl); URL.revokeObjectURL(fwUrl);
      fit();
    });
  }).catch(function (e) {
    say("failed: " + (e && e.message ? e.message : e));
    console.error(e);
  });
})();
