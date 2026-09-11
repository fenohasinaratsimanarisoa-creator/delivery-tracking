// Petit script CLI exécuté dans un vrai process Node (pas dans le bac à sable VM de
// Jest, qui ne supporte pas `import.meta` utilisé par pdfjs-dist) — lancé en
// sous-processus par delivery-import-parser.pdf.spec.ts pour vérifier que le
// parsing PDF réel se comporte comme en production.
import { parsePdfImportRows } from '../delivery-import-parser';
import * as fs from 'fs';

async function main() {
  const filePath = process.argv[2];
  const buffer = fs.readFileSync(filePath);
  const rows = await parsePdfImportRows(buffer);
  process.stdout.write(JSON.stringify(rows));
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err));
  process.exit(1);
});
