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

  function get(url, type) {
    return fetch(url, { cache: "force-cache" }).then(function (r) {
      if (!r.ok) throw new Error(url + " -> HTTP " + r.status);
      return type === "text" ? r.text() : r.arrayBuffer();
    });
  }

  var done = 0, totalParts = 0;
  function tick() { say("downloading " + done + "/" + totalParts + " parts"); }

  // fetch one file's chunks with limited concurrency, preserving order
  function fetchChunks(spec) {
    var parts = spec.parts, buf = new Uint8Array(spec.total), at = [], off = 0;
    parts.forEach(function (p) { at.push(off); off += p.size; });
    var next = 0, LIMIT = 6;
    function worker() {
      if (next >= parts.length) return Promise.resolve();
      var i = next++;
      return get(BASE + "chunks/" + parts[i].name).then(function (ab) {
        buf.set(new Uint8Array(ab), at[i]);
        done++; tick();
        return worker();
      });
    }
    var runners = [];
    for (var k = 0; k < Math.min(LIMIT, parts.length); k++) runners.push(worker());
    return Promise.all(runners).then(function () { return buf; });
  }

  say("fetching manifest");
  get(BASE + "manifest.json", "text").then(function (t) {
    var man = JSON.parse(t);
    totalParts = man.files.data.parts.length + man.files.wasm.parts.length;
    tick();
    return Promise.all([
      fetchChunks(man.files.data),
      fetchChunks(man.files.wasm),
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
