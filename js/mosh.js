/* Frana: pipeline datamosh interamente nel browser.
 * Porting fedele di mosh.py (stessa logica, stessi argomenti ffmpeg).
 *
 * Idea: ogni clip viene ricodificato in MPEG-4 part 2 con un solo keyframe (I-frame)
 * e senza B-frame. Dal secondo clip in poi si scarta l'I-frame: il decoder applica i
 * P-frame del clip B ai pixel del clip A. Gli "stili" ripetono, mescolano o
 * alterano quei P-frame.
 */
const Mosh = (() => {
  const MODES = ['bloom', 'melt', 'pulse', 'shake', 'corrupt'];

  /* generatore pseudo-casuale con seed (mulberry32) */
  function rngFrom(seed) {
    let a = seed >>> 0;
    const random = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      random,
      int: (lo, hi) => lo + Math.floor(random() * (hi - lo)),   // [lo, hi)
      shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
      },
    };
  }

  /* Divide uno stream MPEG-4 part 2 in { header, vops: [{type, bytes}] }.
   * type: 0 = I, 1 = P, 2 = B. Start code del VOP: 00 00 01 B6. */
  function splitVops(data) {
    const starts = [];
    for (let i = 0; i + 3 < data.length; i++) {
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1 && data[i + 3] === 0xb6) {
        starts.push(i);
        i += 3;                         // match non sovrapposti
      }
    }
    if (!starts.length) throw new Error('Nessun frame trovato nel clip');
    const vops = starts.map((s, k) => ({
      type: data[s + 4] >> 6,
      bytes: data.subarray(s, k + 1 < starts.length ? starts[k + 1] : data.length),
    }));
    return { header: data.subarray(0, starts[0]), vops };
  }

  /* Trasforma i P-frame del clip che segue una transizione.
   * intensity 0 = solo rimozione dell'I-frame. p: array di Uint8Array. */
  function applyMode(p, mode, intensity, fps, rng) {
    if (intensity <= 0 || !p.length) return p;
    const t = Math.min(1, intensity / 60);
    const wlen = Math.min(p.length, Math.max(2, Math.floor(fps / 2)));
    let big = 0;                         // il P-frame più grande: a parità, il primo
    for (let k = 1; k < wlen; k++) if (p[k].length > p[big].length) big = k;

    if (mode === 'bloom') {
      const out = p.slice(0, big + 1);
      for (let k = 0; k < intensity; k++) out.push(p[big]);
      return out.concat(p.slice(big + 1));
    }
    if (mode === 'melt') {
      const rep = 2 + Math.floor(t * 3), zone = fps * 2, out = [];
      p.forEach((x, k) => { const n = k < zone ? rep : 1; for (let j = 0; j < n; j++) out.push(x); });
      return out;
    }
    if (mode === 'pulse') {
      const group = p.slice(big, big + 6), loops = 1 + Math.floor(t * 8);
      let out = p.slice(0, big);
      for (let j = 0; j < 1 + loops; j++) out = out.concat(group);
      return out.concat(p.slice(big + 6));
    }
    if (mode === 'shake') {
      const w = 3 + Math.floor(t * 6), zone = fps * 3;
      let out = [];
      for (let i = 0; i < p.length; i += w) {
        const chunk = p.slice(i, i + w);
        if (i < zone) rng.shuffle(chunk);
        out = out.concat(chunk);
      }
      return out;
    }
    if (mode === 'corrupt') {
      const prob = 0.15 + 0.6 * t, nbytes = 1 + Math.floor(t * 10), zone = fps * 3;
      return p.map((x, k) => {
        if (k < zone && x.length > 24 && rng.random() < prob) {
          const b = x.slice();           // copia: non si tocca l'originale in cache
          for (let j = 0; j < nbytes; j++) b[rng.int(12, b.length)] ^= rng.int(1, 256);  // header intatto
          return b;
        }
        return x;
      });
    }
    return p;
  }

  function concat(parts) {
    let n = 0;
    for (const x of parts) n += x.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const x of parts) { out.set(x, o); o += x.length; }
    return out;
  }

  const normalizeArgs = (src, dst, w, h, fps, seconds) => [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', src, '-t', String(seconds),
    '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
           `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`,
    '-an', '-c:v', 'mpeg4', '-q:v', '3', '-g', '99999', '-bf', '0', '-f', 'm4v', dst,
  ];

  const encodeArgs = (src, dst, fps) => [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-framerate', String(fps), '-f', 'm4v', '-i', src,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dst,
  ];

  /* files: array di File. opts: {width,height,fps,seconds,bloom,mode,seed}.
   * cache: risultato della normalizzazione di una chiamata precedente (o null):
   * se file e dimensioni non cambiano, "Rifai" salta la parte lenta.
   * onStatus({stage, total, label, frac}). Ritorna { mp4: Uint8Array, cache }. */
  async function render(engine, files, opts, cache, onStatus) {
    const { fps, seconds, bloom, mode, seed } = opts;
    const width = opts.width - (opts.width % 2), height = opts.height - (opts.height % 2);
    if (files.length < 2) throw new Error('Servono almeno 2 video');
    if (!MODES.includes(mode)) throw new Error('Stile sconosciuto');
    const rng = rngFrom(seed), n = files.length, total = n + 1;

    const key = JSON.stringify([files.map(f => [f.name, f.size, f.lastModified]), width, height, fps, seconds]);
    if (!cache || cache.key !== key) {
      const clips = [];
      const paths = await engine.addInputs(files);
      try {
        for (let i = 0; i < n; i++) {
          const label = `Clip ${i + 1} di ${n}`, out = `clip${i}.m4v`;
          onStatus({ stage: i, total, label, frac: 0 });
          await engine.exec(normalizeArgs(paths[i], out, width, height, fps, seconds),
                            f => onStatus({ stage: i, total, label, frac: f }));
          const data = await engine.readFile(out);
          await engine.deleteFile(out);
          clips.push(splitVops(data));
        }
      } finally {
        await engine.removeInputs();
      }
      cache = { key, clips };
    }

    // montaggio: il primo clip intero, dagli altri via l'I-frame + lo stile scelto
    const parts = [cache.clips[0].header];
    cache.clips[0].vops.forEach(v => parts.push(v.bytes));
    for (let i = 1; i < n; i++) {
      const pframes = cache.clips[i].vops.filter(v => v.type !== 0).map(v => v.bytes);
      applyMode(pframes, mode, bloom, fps, rng).forEach(b => parts.push(b));
    }

    const label = 'Sciolgo i pixel…';
    onStatus({ stage: n, total, label, frac: 0 });
    await engine.writeFile('mosh.m4v', concat(parts));
    await engine.exec(encodeArgs('mosh.m4v', 'out.mp4', fps), f => onStatus({ stage: n, total, label, frac: f }));
    const mp4 = await engine.readFile('out.mp4');
    await engine.deleteFile('mosh.m4v');
    await engine.deleteFile('out.mp4');
    return { mp4, cache };
  }

  return { MODES, render, splitVops, applyMode, rngFrom };
})();
