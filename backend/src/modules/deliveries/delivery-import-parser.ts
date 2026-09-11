import * as ExcelJS from 'exceljs';
import { BadRequestException } from '@nestjs/common';

/**
 * Ligne brute extraite d'un fichier Excel ou PDF d'import de livraisons, avant
 * conversion en champs Prisma (parseAmount, etc). `row` sert uniquement aux
 * messages d'erreur — pour le PDF, c'est l'index séquentiel de la commande
 * détectée (il n'y a pas de numéro de ligne de feuille de calcul).
 */
export interface RawImportRow {
  row: number;
  orderRef?: string;
  lieu?: string;
  adresse?: string;
  telephone?: string;
  montant?: string;
  prix?: string;
  produits?: string;
  observation?: string;
  notes?: string;
}

export async function parseXlsxImportRows(fileBuffer: Uint8Array): Promise<RawImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  await (workbook.xlsx as any).load(fileBuffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new BadRequestException('Le fichier Excel est vide');

  const headerRow = worksheet.getRow(1);
  const colMap = new Map<string, number>();
  headerRow.eachCell((cell, colNumber) => {
    const val = String(cell.value || '').trim();
    if (val) colMap.set(val, colNumber);
  });

  const getCol = (row: number, name: string): string | undefined => {
    const col = colMap.get(name);
    if (!col) return undefined;
    const cell = worksheet.getRow(row).getCell(col);
    const v = cell.value;
    if (v === null || v === undefined) return undefined;
    return String(v).trim();
  };

  const rows: RawImportRow[] = [];
  const totalRows = worksheet.rowCount;
  for (let rowNum = 2; rowNum <= totalRows; rowNum++) {
    rows.push({
      row: rowNum,
      orderRef: getCol(rowNum, 'N° Commande'),
      lieu: getCol(rowNum, 'Lieu'),
      adresse: getCol(rowNum, 'Adresse'),
      telephone: getCol(rowNum, 'Téléphone'),
      montant: getCol(rowNum, 'Montant'),
      prix: getCol(rowNum, 'Prix'),
      produits: getCol(rowNum, 'Produits commandés'),
      observation: getCol(rowNum, 'Observation'),
      notes: getCol(rowNum, 'Notes'),
    });
  }
  return rows;
}

interface LayoutItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

interface LayoutLine {
  y: number;
  items: LayoutItem[];
}

/**
 * Reconstruit, page par page, des lignes de texte alignées en colonnes à partir des
 * positions x/y de chaque fragment de texte du PDF — équivalent maison de
 * `pdftotext -layout`, mais en pur JS (pas de dépendance système type poppler à
 * installer sur le serveur). Les fragments sont d'abord groupés par y (une ligne
 * du tableau peut être rendue avec de légers écarts de baseline entre colonnes,
 * d'où la tolérance), puis positionnés sur une grille de caractères dont la
 * largeur est estimée à partir de la largeur moyenne des fragments de la page.
 */
async function extractLayoutLines(fileBuffer: Uint8Array): Promise<string[][]> {
  // Import dynamique : pdfjs-dist n'est publié qu'en ESM, ce module (CJS via NestJS) doit donc
  // l'importer avec `import()` plutôt qu'un `require` statique.
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdf.js refuse un Node `Buffer` (sous-classe de Uint8Array) et exige un Uint8Array
  // "pur" — or multer fournit `file.buffer` comme un Buffer, d'où cette copie explicite.
  const data = new Uint8Array(fileBuffer);
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const pages: string[][] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const items: LayoutItem[] = (content.items as any[])
      .filter((it) => typeof it.str === 'string' && it.str.trim() !== '')
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width }));

    const Y_TOLERANCE = 3;
    const lines: LayoutLine[] = [];
    const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
    for (const it of sorted) {
      let best: LayoutLine | null = null;
      let bestDiff = Infinity;
      for (const l of lines) {
        const diff = Math.abs(l.y - it.y);
        if (diff < Y_TOLERANCE && diff < bestDiff) {
          best = l;
          bestDiff = diff;
        }
      }
      if (!best) {
        best = { y: it.y, items: [] };
        lines.push(best);
      } else {
        best.y = (best.y * best.items.length + it.y) / (best.items.length + 1);
      }
      best.items.push(it);
    }
    lines.sort((a, b) => b.y - a.y);

    let totalWidth = 0;
    let totalChars = 0;
    for (const it of items) {
      totalWidth += it.width;
      totalChars += it.str.length;
    }
    const avgCharWidth = totalChars > 0 ? totalWidth / totalChars : 5;

    const pageLines: string[] = [];
    for (const line of lines) {
      line.items.sort((a, b) => a.x - b.x);
      let out = '';
      let curCol = 0;
      for (const it of line.items) {
        const col = Math.round(it.x / avgCharWidth);
        const pad = Math.max(col - curCol, 1);
        out += ' '.repeat(pad) + it.str;
        curCol = col + it.str.length;
      }
      pageLines.push(out);
    }
    pages.push(pageLines);
  }
  return pages;
}

const COLUMN_ORDER = [
  'orderRef',
  'montant',
  'lieu',
  'telephone',
  'observation',
  'produitsPrix',
] as const;
type ColumnKey = (typeof COLUMN_ORDER)[number];
const HEADER_MARKERS: Record<ColumnKey, string> = {
  orderRef: 'N°',
  montant: 'Montant',
  lieu: 'Lieu',
  telephone: 'Téléphone',
  observation: 'Observation',
  produitsPrix: 'Produits',
};
const ORDER_REF_RE = /^\d{6}-\d{5}$/;
const PRICE_RE = /(\d{1,3}(?: \d{3})*)\s*Ar\b/;

export async function parsePdfImportRows(fileBuffer: Uint8Array): Promise<RawImportRow[]> {
  const pages = await extractLayoutLines(fileBuffer);

  type PartialRow = Partial<Record<ColumnKey, string>> & { lieu?: string; adresse?: string };
  const rows: PartialRow[] = [];
  let bounds: Record<ColumnKey, number> | null = null;
  let colOrder: ColumnKey[] | null = null;
  let current: PartialRow | null = null;

  const sliceColumns = (line: string): Record<ColumnKey, string> => {
    const vals = {} as Record<ColumnKey, string>;
    for (let i = 0; i < colOrder!.length; i++) {
      const key = colOrder![i];
      const start = bounds![key];
      const end = i + 1 < colOrder!.length ? bounds![colOrder![i + 1]] : line.length;
      vals[key] = start < line.length ? line.slice(start, end).trim() : '';
    }
    return vals;
  };

  const flush = () => {
    if (current) {
      rows.push(current);
      current = null;
    }
  };

  for (const pageLines of pages) {
    for (const line of pageLines) {
      if (line.includes('Commande') && line.includes('Montant')) {
        bounds = {} as Record<ColumnKey, number>;
        for (const key of COLUMN_ORDER) bounds[key] = line.indexOf(HEADER_MARKERS[key]);
        colOrder = [...COLUMN_ORDER].sort((a, b) => bounds![a] - bounds![b]);
        flush();
        continue;
      }
      if (!bounds || !line.trim()) continue;

      const vals = sliceColumns(line);
      if (ORDER_REF_RE.test(vals.orderRef)) {
        flush();
        current = { ...vals };
      } else if (current) {
        // Ligne de continuation (adresse détaillée sur 2 lignes, observation ou
        // libellé produit qui wrap) : le premier fragment de "lieu" rencontré est
        // la ville/le quartier (colonne Lieu de l'en-tête), les suivants sont
        // rattachés à l'adresse détaillée plutôt que concaténés à la ville.
        if (vals.lieu) {
          current.adresse = current.adresse ? `${current.adresse} ${vals.lieu}` : vals.lieu;
        }
        for (const key of ['telephone', 'observation', 'produitsPrix'] as ColumnKey[]) {
          if (vals[key]) current[key] = current[key] ? `${current[key]} ${vals[key]}` : vals[key];
        }
      }
    }
  }
  flush();

  return rows.map((r, idx) => {
    const produitsPrix = r.produitsPrix || '';
    const match = PRICE_RE.exec(produitsPrix);
    const prix = match ? match[1].replace(/ /g, '') : undefined;
    const produits = match
      ? (produitsPrix.slice(0, match.index) + produitsPrix.slice(match.index + match[0].length))
          .replace(/\s+/g, ' ')
          .trim()
      : produitsPrix.trim();
    return {
      row: idx + 1,
      orderRef: r.orderRef || undefined,
      lieu: r.lieu || undefined,
      adresse: r.adresse || undefined,
      telephone: r.telephone || undefined,
      montant: r.montant || undefined,
      prix: prix || undefined,
      produits: produits || undefined,
      observation: r.observation || undefined,
    };
  });
}
