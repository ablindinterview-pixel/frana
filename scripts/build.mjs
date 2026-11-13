// Prepara _site/ con tutto ciò che serve alla pagina (e nient'altro).
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

rmSync('_site', { recursive: true, force: true });
mkdirSync('_site', { recursive: true });
for (const p of ['index.html', 'manifest.webmanifest', 'assets', 'js', 'vendor']) {
  cpSync(p, `_site/${p}`, { recursive: true });
}
writeFileSync('_site/.nojekyll', '');
console.log('_site pronto');
