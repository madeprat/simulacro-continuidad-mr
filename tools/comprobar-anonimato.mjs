#!/usr/bin/env node
// Control de anonimato: falla si algún fichero versionado contiene referencias a la organización real,
// a sus sistemas o a personas, o correos fuera de los dominios ficticios .example (RFC 2606).
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
// Correos: solo se admiten buzones ficticios del dominio reservado .example (compania.example, colegio.example…).
const CORREO = /[A-Za-z0-9._%+-]+@(?![A-Za-z0-9-]+\.example\b)[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

const EXCLUIR = [/^vendor\//, /^tools\/comprobar-anonimato\.mjs$/, /\.(png|jpe?g|gif|webp|ico|mp3|mp4|glb|woff2?)$/i];
// Documentos Office modernos (docx, pptx, xlsx): son ZIP de XML y se revisan por dentro, metadatos incluidos
// (autor, último en modificar, comentarios). Los formatos que no se pueden revisar como texto no se admiten.
const OFFICE = /\.(docx|pptx|xlsx)$/i;
const BINARIOS = /\.(doc|xls|ppt|pdf|zip)$/i;

const ficheros = execSync('git ls-files -co --exclude-standard', { encoding: 'utf8' }).split('\n').filter(Boolean)
  .filter((f) => fs.existsSync(f) && !EXCLUIR.some((re) => re.test(f)));

const hallazgos = [];
for (const f of ficheros) {
  if (BINARIOS.test(f)) { hallazgos.push(`${f}: documento binario no permitido en el repositorio (usa .docx, .pptx o .xlsx)`); continue; }
  let lineas;
  if (OFFICE.test(f)) {
    try {
      // Cada «línea» es un fragmento entre etiquetas XML: así el hallazgo señala el texto o el atributo concreto.
      lineas = execSync(`unzip -p ${JSON.stringify(f)} '*.xml' '*.rels'`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('>');
    } catch {
      hallazgos.push(`${f}: no se pudo abrir el documento para revisarlo`); continue;
    }
  } else lineas = fs.readFileSync(f, 'utf8').split('\n');
  lineas.forEach((l, i) => {
    for (const re of [...PATRONES, CORREO]) {
      if (re.test(l)) { hallazgos.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`); break; }
    }
  });
}

if (hallazgos.length) {
  console.error(`✗ Control de anonimato: ${hallazgos.length} hallazgo(s)\n` + hallazgos.map((h) => '  ' + h).join('\n'));
  if (hallazgos.some((h) => OFFICE.test(h.split(':')[0]))) {
    console.error('  En documentos Office, revisa también los metadatos: en Word, Archivo → Información → Inspeccionar documento →' +
      ' Propiedades del documento e información personal → Quitar todo, y vuelve a guardar.');
  }
  process.exit(1);
}
console.log(`✓ Control de anonimato: ${ficheros.length} ficheros revisados, sin referencias identificativas.`);
