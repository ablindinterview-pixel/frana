// Copia ffmpeg.wasm dai pacchetti npm in vendor/ (stessa origine della pagina: serve ai Worker).
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';

const need = path => {
  if (!existsSync(path)) throw new Error(`Manca ${path}: la struttura del pacchetto è cambiata? Controlla le versioni in package.json.`);
  return path;
};

rmSync('vendor', { recursive: true, force: true });
mkdirSync('vendor/ffmpeg', { recursive: true });
mkdirSync('vendor/core', { recursive: true });

cpSync(need('node_modules/@ffmpeg/ffmpeg/dist/umd'), 'vendor/ffmpeg', { recursive: true });
cpSync(need('node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js'), 'vendor/core/ffmpeg-core.js');
cpSync(need('node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm'), 'vendor/core/ffmpeg-core.wasm');
console.log('vendor pronto');
