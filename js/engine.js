/* Motore video: ffmpeg compilato per il browser (WebAssembly, versione a un solo thread,
 * l'unica possibile su GitHub Pages). I file di ffmpeg.wasm non sono nel repository: li
 * copia nella cartella vendor/ lo script scripts/vendor.mjs (vedi README).
 *
 * Interfaccia (la usa js/mosh.js):
 *   addInputs(files) -> percorsi leggibili da ffmpeg     removeInputs()
 *   writeFile(path, Uint8Array)   readFile(path) -> Uint8Array   deleteFile(path)
 *   exec(args, onProgress(0..1))  terminate()
 */
const WasmEngine = (() => {
  const abs = p => new URL(p, location.href).href;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('File mancante: ' + src));
      document.head.append(s);
    });
  }

  async function create() {
    if (typeof FFmpegWASM === 'undefined') await loadScript(abs('vendor/ffmpeg/ffmpeg.js'));
    const ff = new FFmpegWASM.FFmpeg();
    let onProg = null, tail = [];
    ff.on('progress', ({ progress }) => { if (onProg && isFinite(progress)) onProg(Math.min(1, Math.max(0, progress))); });
    ff.on('log', ({ message }) => { tail.push(message); if (tail.length > 8) tail.shift(); });
    await ff.load({ coreURL: abs('vendor/core/ffmpeg-core.js'), wasmURL: abs('vendor/core/ffmpeg-core.wasm') });

    let mounted = false, copied = [];
    const quiet = async fn => { try { return await fn(); } catch (_) { return undefined; } };

    return {
      /* Preferisce WORKERFS: ffmpeg legge i file direttamente, senza copiarli in memoria
       * (importante per i video del telefono, spesso da decine di MB). Se non va,
       * ricade sulla copia in memoria. */
      async addInputs(files) {
        const named = files.map((f, i) => new File([f], 'in' + i));
        try {
          await quiet(() => ff.createDir('/in'));
          await ff.mount('WORKERFS', { files: named }, '/in');
          mounted = true;
          const listed = (await ff.listDir('/in')).filter(x => !x.isDir).length;
          if (listed < named.length) throw new Error('mount incompleto');
          return named.map(f => '/in/' + f.name);
        } catch (_) {
          if (mounted) { await quiet(() => ff.unmount('/in')); mounted = false; }
          copied = [];
          for (let i = 0; i < files.length; i++) {
            await ff.writeFile('in' + i, new Uint8Array(await files[i].arrayBuffer()));
            copied.push('in' + i);
          }
          return copied.slice();
        }
      },
      async removeInputs() {
        if (mounted) { await quiet(() => ff.unmount('/in')); mounted = false; }
        for (const p of copied) await quiet(() => ff.deleteFile(p));
        copied = [];
      },
      writeFile: (p, data) => ff.writeFile(p, data),
      readFile: p => ff.readFile(p),
      deleteFile: p => quiet(() => ff.deleteFile(p)),
      async exec(args, onProgress) {
        onProg = onProgress || null; tail = [];
        const code = await ff.exec(args);
        onProg = null;
        if (code !== 0) throw new Error('ffmpeg ha fallito: ' + tail.join(' ').slice(-300));
      },
      terminate() { quiet(() => ff.terminate()); },
    };
  }

  return { create };
})();
