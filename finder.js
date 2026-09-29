/* Find channel: read text from a screenshot (Tesseract.js, in the browser), then search YouTube cheapest-first. */
(function () {
  'use strict';
  var A = window.OFApp, $ = A.$, el = A.el;
  // tesseract.js 5.1.1, vendored (same origin, see vendor/README.md) and loaded only when a screenshot is used.
  // Its worker, WebAssembly core and language data download from jsDelivr and run in a Web Worker.
  var TESS_SRC = 'vendor/tesseract.min.js';
  var MAX_BYTES = 15 * 1024 * 1024;
  var st = { url: null, subHint: null, busy: false, token: 0 };

  // ---------- OCR ----------
  var tessPromise = null;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!tessPromise) {
      tessPromise = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = TESS_SRC; s.async = true;
        s.onload = function () { window.Tesseract ? resolve(window.Tesseract) : reject(new Error('reader missing')); };
        s.onerror = function () { tessPromise = null; reject(new Error('reader blocked')); };
        document.head.appendChild(s);
      });
    }
    return tessPromise;
  }

  function loadBitmap(file) {
    if (window.createImageBitmap) return createImageBitmap(file);
    return new Promise(function (resolve, reject) {
      var img = new Image(), u = URL.createObjectURL(file);
      img.onload = function () { URL.revokeObjectURL(u); resolve(img); };
      img.onerror = function () { reject(new Error('bad image')); };
      img.src = u;
    });
  }

  /** Scale to a sensible size, grayscale, and flip dark-mode screenshots to dark-on-light (OCR reads that best). */
  function prepare(file) {
    return loadBitmap(file).then(function (bmp) {
      var w = bmp.width, h = bmp.height, k = 1;
      if (w > 1800) k = 1800 / w; else if (w < 700) k = Math.min(3, 1200 / w);
      var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
      var g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0, c.width, c.height);
      var img = g.getImageData(0, 0, c.width, c.height), d = img.data, sum = 0, i;
      for (i = 0; i < d.length; i += 4) { var y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = y; sum += y; }
      if (sum / (d.length / 4) < 110) for (i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
      g.putImageData(img, 0, 0);
      return c;
    });
  }

  var PHASES = {
    'loading tesseract core': [0, 0.15], 'initializing tesseract': [0.15, 0.2], 'loading language traineddata': [0.2, 0.5],
    'initializing api': [0.5, 0.55], 'recognizing text': [0.55, 1]
  };
  function setProgress(frac, text) {
    var pct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
    $('finderBar').style.width = pct + '%';
    $('finderProgress').setAttribute('aria-valuenow', pct);
    if (text != null) $('finderStatus').textContent = text;
  }

  function readText(file, token) {
    setProgress(0.02, 'Loading the text reader… (one-time download, about 10 MB)');
    return Promise.all([loadTesseract(), prepare(file)]).then(function (r) {
      if (token !== st.token) throw new Error('cancelled');
      return r[0].recognize(r[1], 'eng', {
        logger: function (m) {
          var ph = PHASES[m.status];
          if (ph && token === st.token) setProgress(ph[0] + (ph[1] - ph[0]) * (m.progress || 0), m.status === 'recognizing text' ? 'Reading the text…' : 'Loading the text reader…');
        }
      });
    }).then(function (res) { return (res && res.data && res.data.text) || ''; });
  }

  // ---------- UI flow ----------
  function reset() {
    st.token++; st.subHint = null;
    if (st.url) { URL.revokeObjectURL(st.url); st.url = null; }
    $('finderWork').hidden = true; $('dropzone').hidden = false;
    $('finderLines').value = ''; $('fileInput').value = '';
    var raw = $('finderWork').querySelector('.raw'); if (raw) raw.remove();
    A.say($('finderMsg'), ''); $('finderResults').textContent = '';
  }

  function updateHint() {
    var q = OFI.parseQueryLines($('finderLines').value), n = 0;
    var searches = (q.channelLines.length ? 1 : 0) + (q.titleLines.length ? 1 : 0);
    n = q.handles.length ? q.handles.length : searches * 100 + 1;
    var parts = [];
    if (st.subHint) parts.push('Subscriber hint from the screenshot: ~' + OF.formatCount(st.subHint));
    parts.push(q.handles.length ? 'A handle is the cheapest and most reliable clue (about ' + n + ' unit' + (n > 1 ? 's' : '') + ').' : 'Searching will use about ' + n + ' quota units.');
    $('finderHint').textContent = parts.join(' · ');
    $('finderGo').disabled = st.busy || !(q.handles.length || q.channelLines.length || q.titleLines.length);
  }

  function handleFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) return A.say($('finderMsg'), 'That file is not an image. Try a PNG or JPG screenshot.', true);
    if (file.size > MAX_BYTES) return A.say($('finderMsg'), 'That image is over 15 MB. Try a smaller screenshot.', true);
    reset();
    var token = st.token;
    st.url = URL.createObjectURL(file);
    $('finderPreview').src = st.url;
    $('dropzone').hidden = true; $('finderWork').hidden = false;
    setProgress(0, 'Getting ready…');
    readText(file, token).then(function (text) {
      if (token !== st.token) return;
      var c = OFI.ocrCandidates(text);
      st.subHint = c.subHint;
      $('finderLines').value = c.queries.join('\n');
      var raw = el('details', 'raw'); raw.appendChild(el('summary', null, 'Show everything I read'));
      raw.appendChild(el('pre', null, text.trim() || '(nothing)'));
      $('finderLines').parentNode.insertBefore(raw, $('finderHint'));
      if (!c.queries.length) {
        setProgress(1, "I couldn't find usable text. Try a sharper screenshot, or type the channel name, @handle or title below.");
        updateHint();
      } else {
        setProgress(1, 'Done. Found ' + c.queries.length + ' clue' + (c.queries.length > 1 ? 's' : '') + '. Searching…');
        updateHint(); search();
      }
    }).catch(function (e) {
      if (e.message === 'cancelled' || token !== st.token) return;
      setProgress(0, /reader/.test(e.message) ? "Couldn't load the text reader (offline, or blocked by your network). Type what you can see in the box below instead."
        : "Couldn't read that image. Type what you can see in the box below instead.");
      $('finderLines').focus(); updateHint();
    });
  }

  // ---------- searching ----------
  function search() {
    if (st.busy) return;
    var q = OFI.parseQueryLines($('finderLines').value), evidence = [];
    if (!q.handles.length && !q.channelLines.length && !q.titleLines.length) return;
    st.busy = true; $('finderGo').disabled = true;
    var box = $('finderResults'); box.textContent = ''; box.appendChild(OFC.channelSkeleton()); box.appendChild(OFC.channelSkeleton());
    A.say($('finderMsg'), '');
    var known = {};
    var chain = Promise.resolve();

    // 1. Handles: 1 quota unit each and the most reliable clue.
    q.handles.slice(0, 2).forEach(function (h) {
      chain = chain.then(function () {
        return A.api('channels', { part: 'snippet,statistics,brandingSettings', forHandle: h }, OF.QUOTA.list).then(function (r) {
          (r.items || []).forEach(function (it) {
            var ch = OFI.buildChannel(it); known[ch.id] = ch;
            evidence.push({ channelId: ch.id, kind: 'handle', score: 1, line: h });
          });
        }).catch(function (e) { if (/API key|quota/i.test(e.message)) throw e; });
      });
    });

    // 2. No handle matched: search by channel name, then by video title (100 units each).
    chain = chain.then(function () {
      if (evidence.length) return;
      var p = Promise.resolve();
      if (q.channelLines.length) p = p.then(function () {
        var line = q.channelLines[0];
        return A.api('search', { part: 'snippet', type: 'channel', q: line, maxResults: 5 }, OF.QUOTA.search).then(function (r) {
          (r.items || []).forEach(function (it) {
            var id = it.id && it.id.channelId; if (!id) return;
            evidence.push({ channelId: id, kind: 'name', score: OFI.matchScore(line, it.snippet.channelTitle || it.snippet.title), line: line });
          });
        });
      });
      if (q.titleLines.length) p = p.then(function () {
        var line = q.titleLines[0];
        return A.api('search', { part: 'snippet', type: 'video', q: line, maxResults: 5 }, OF.QUOTA.search).then(function (r) {
          (r.items || []).forEach(function (it) {
            var sc = OFI.matchScore(line, it.snippet.title);
            if (sc >= 0.35) evidence.push({ channelId: it.snippet.channelId, kind: 'title', score: sc, line: line });
          });
        });
      });
      return p;
    });

    chain.then(function () {
      var ids = Array.from(new Set(evidence.map(function (e) { return e.channelId; })));
      var need = ids.filter(function (id) { return !known[id]; });
      return OFC.fetchChannels(need).then(function (list) {
        list.forEach(function (c) { known[c.id] = c; });
        return ids;
      });
    }).then(function (ids) {
      var ranked = OFI.rankCandidates(evidence, st.subHint, known).filter(function (r) { return known[r.channelId]; }).slice(0, 6);
      box.textContent = '';
      if (!ranked.length) {
        A.say($('finderMsg'), 'No channel found for those clues. Check the text above (a typo can hide it), add the channel name or @handle if you can see it, or try a sharper screenshot.', true);
        return;
      }
      var best = ranked[0].confidence;
      if (best < 0.4) A.say($('finderMsg'), 'These are long shots. Add more of what you can see (the channel name or @handle) and search again.');
      ranked.forEach(function (r, i) {
        var c = OFC.channelCard(known[r.channelId], {
          badge: { text: Math.round(r.confidence * 100) + '% match', title: 'How well the clues fit this channel' },
          reasons: r.reasons
        });
        if (i === 0 && best >= 0.7) c.classList.add('best');
        box.appendChild(c);
      });
    }).catch(function (e) { box.textContent = ''; A.fail($('finderMsg'), e); })
      .then(function () { st.busy = false; updateHint(); });
  }

  // ---------- paste a link / handle / name ----------
  function findFromText(text) {
    var box = $('finderResults'); box.textContent = ''; box.appendChild(OFC.channelSkeleton());
    A.say($('finderMsg'), '');
    OFC.resolve(text).then(function (list) {
      box.textContent = '';
      if (!list.length) return A.say($('finderMsg'), 'No channel found. Check the link or try the channel name.', true);
      list.forEach(function (ch) { box.appendChild(OFC.channelCard(ch, { reasons: list.length === 1 ? ['Found from what you pasted'] : null })); });
    }).catch(function (e) { box.textContent = ''; A.fail($('finderMsg'), e); });
  }

  // ---------- events ----------
  var dz = $('dropzone');
  dz.addEventListener('click', function () { $('fileInput').click(); });
  dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); } });
  $('fileInput').addEventListener('change', function (e) { handleFile(e.target.files[0]); });
  ['dragenter', 'dragover'].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.remove('over'); }); });
  dz.addEventListener('drop', function (e) { handleFile(e.dataTransfer && e.dataTransfer.files[0]); });
  document.addEventListener('paste', function (e) {
    if (document.body.dataset.view !== 'finder') return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) if (/^image\//.test(items[i].type)) { e.preventDefault(); return handleFile(items[i].getAsFile()); }
  });
  $('finderLines').addEventListener('input', updateHint);
  $('finderGo').addEventListener('click', search);
  $('finderReset').addEventListener('click', reset);
  $('finderForm').addEventListener('submit', function (e) { e.preventDefault(); var v = $('finderText').value.trim(); if (v) findFromText(v); });
  A.register('finder', { show: function () {} });
})();
