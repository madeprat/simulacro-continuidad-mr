#!/usr/bin/env node
// Control de anonimato: falla si algún fichero versionado contiene referencias a la organización real,
// a sus sistemas o a personas, o correos fuera del dominio ficticio compania.example.
// Los patrones van codificados en base64 para que este script no los contenga en claro.
// Uso: node tools/comprobar-anonimato.mjs   (también lo ejecuta la integración continua)
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const PATRONES = [
  'XGJzMmdcYnxzMmdbLV9dfHMyZ3JwfHMyZ3J1cG98XGJTMlxzK0dydXBvXGJ8XGJTMlxi',
  'XGJlbWFzXGJ8ZW1hc2M=',
  'c2hhcmVwb2ludHxDTkluY2lkZW50RW1lcmdlbmN5RG9j',
  'b2NtYw==',
  'Ym9nb3RbYcOhXQ==',
  'bWFkZWxhaW5lfHJvc2FsW2nDrV1hXHMrY2FzdHJv',
].map((b) => new RegExp(Buffer.from(b, 'base64').toString('utf8'), 'i'));
// Correos: solo se admiten buzones ficticios de compania.example.
const CORREO = /[A-Za-z0-9._%+-]+@(?!compania\.example\b)[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

const EXCLUIR = [/^vendor\//, /^tools\/comprobar-anonimato\.mjs$/, /\.(png|jpe?g|gif|webp|ico|mp3|mp4|glb|woff2?)$/i];
const BINARIOS = /\.(docx?|xlsx?|pptx?|pdf|zip)$/i;

const ficheros = execSync('git ls-files -co --exclude-standard', { encoding: 'utf8' }).split('\n').filter(Boolean)
  .filter((f) => fs.existsSync(f) && !EXCLUIR.some((re) => re.test(f)));

const hallazgos = [];
for (const f of ficheros) {
  if (BINARIOS.test(f)) { hallazgos.push(`${f}: documento binario no permitido en el repositorio`); continue; }
  const lineas = fs.readFileSync(f, 'utf8').split('\n');
  lineas.forEach((l, i) => {
    for (const re of [...PATRONES, CORREO]) {
      if (re.test(l)) { hallazgos.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`); break; }
    }
  });
}

if (hallazgos.length) {
  console.error(`✗ Control de anonimato: ${hallazgos.length} hallazgo(s)\n` + hallazgos.map((h) => '  ' + h).join('\n'));
  process.exit(1);
}
console.log(`✓ Control de anonimato: ${ficheros.length} ficheros revisados, sin referencias identificativas.`);
