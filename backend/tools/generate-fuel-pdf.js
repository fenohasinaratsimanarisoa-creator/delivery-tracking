const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// ─── Palette (couleurs de la marque) ─────────────────────────
const C = {
  ink: rgb(0.043, 0.071, 0.125),       // #0B1220
  rowHeader: rgb(0.09, 0.12, 0.18),    // #171F31
  amber: rgb(0.95, 0.66, 0.24),        // #F2A93C
  teal: rgb(0.247, 0.655, 0.588),      // #3FA796
  text: rgb(0.11, 0.13, 0.16),
  muted: rgb(0.36, 0.42, 0.51),
  line: rgb(0.82, 0.85, 0.89),
  white: rgb(1, 1, 1),
  rowAlt: rgb(0.955, 0.965, 0.975),
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 46;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y = 34;

// ─── Construction ────────────────────────────────────────────
(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  let pageNo = 1;

  const ensureSpace = (needed) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      pageNo++;
    }
  };

  const footer = () => {
    page.drawText(
      `Système de gestion de carburant — Document client   ·   Page ${pageNo}`,
      { x: MARGIN, y: FOOTER_Y, size: 8, font: italic, color: C.muted },
    );
    page.drawLine({ start: { x: MARGIN, y: FOOTER_Y + 12 }, end: { x: PAGE_W - MARGIN, y: FOOTER_Y + 12 }, thickness: 0.5, color: C.line });
  };

  // Découpe un texte en lignes qui tiennent dans maxW, avec rupture des mots trop longs.
  const wrap = (text, f, size, maxW) => {
    const words = String(text).split(/\s+/);
    const lines = [];
    let cur = '';
    for (let w of words) {
      while (f.widthOfTextAtSize(w, size) > maxW && w.length > 1) {
        // Coupe le mot trop long
        let cut = w.length;
        while (cut > 1 && f.widthOfTextAtSize(w.slice(0, cut), size) > maxW) cut--;
        lines.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      const test = cur ? cur + ' ' + w : w;
      if (f.widthOfTextAtSize(test, size) <= maxW) {
        cur = test;
      } else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  };

  const heading = (title) => {
    ensureSpace(40);
    y -= 16;
    page.drawText(title, { x: MARGIN, y, size: 14, font: bold, color: C.ink });
    y -= 3;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + 24, y }, thickness: 2.5, color: C.amber });
    y -= 12;
  };

  const paragraph = (text, opts = {}) => {
    const size = opts.size || 9.5;
    const color = opts.color || C.text;
    const f = opts.bold ? bold : font;
    const lines = wrap(text, f, size, CONTENT_W);
    for (const l of lines) {
      ensureSpace(size + 4);
      page.drawText(l, { x: MARGIN, y, size, font: f, color });
      y -= size + 4;
    }
    if (opts.after) y -= opts.after;
  };

  const drawTable = (headers, rows, colWidths) => {
    const size = 9;
    const lineGap = 3;
    const padY = 6;
    const padX = 7;
    const x0 = MARGIN;
    // Normalise les largeurs : le total = largeur utile de la page (évite tout débordement).
    const total = colWidths.reduce((a, b) => a + b, 0);
    const widths = colWidths.map((w) => (w * CONTENT_W) / total);

    const cellLines = (text, w, f) => wrap(text, f, size, w - padX * 2);

    const rowHeight = (cells, f) => {
      const maxLines = Math.max(...cells.map((c, i) => cellLines(c, widths[i], f).length));
      return maxLines * (size + lineGap) + padY * 2 + 2;
    };

    const drawHeader = () => {
      const h = rowHeight(headers, bold);
      ensureSpace(h + 4);
      y -= h;
      page.drawRectangle({ x: x0, y, width: CONTENT_W, height: h, color: C.rowHeader });
      let cx = x0 + padX;
      headers.forEach((hText, i) => {
        const lines = cellLines(hText, widths[i], bold);
        let cy = y + h - padY - size;
        lines.forEach((l) => {
          page.drawText(l, { x: cx, y: cy, size, font: bold, color: C.white });
          cy -= size + lineGap;
        });
        cx += widths[i];
      });
      return h;
    };

    const drawRow = (cells, isAlt) => {
      const h = rowHeight(cells, font);
      ensureSpace(h + 2);
      y -= h;
      if (isAlt) page.drawRectangle({ x: x0, y, width: CONTENT_W, height: h, color: C.rowAlt });
      page.drawLine({ start: { x: x0, y: y + h }, end: { x: x0 + CONTENT_W, y: y + h }, thickness: 0.5, color: C.line });
      let cx = x0 + padX;
      cells.forEach((cell, i) => {
        const lines = cellLines(cell, widths[i], font);
        let cy = y + h - padY - size;
        lines.forEach((l) => {
          page.drawText(l, { x: cx, y: cy, size, font, color: C.text });
          cy -= size + lineGap;
        });
        cx += widths[i];
      });
    };

    const h = drawHeader();
    rows.forEach((r, i) => drawRow(r, i % 2 === 1));
    y -= h; // petit espace sous le tableau
  };

  // ═══════════════════ EN-TÊTE ═══════════════════
  page.drawRectangle({ x: 0, y: PAGE_H - 6, width: PAGE_W, height: 6, color: C.amber });
  y = PAGE_H - MARGIN - 6;
  page.drawText('DELIVERY TRACK', { x: MARGIN, y: y + 4, size: 9, font: bold, color: C.teal, letterSpacing: 2 });
  y -= 26;
  page.drawText('Système de gestion de carburant', { x: MARGIN, y, size: 22, font: bold, color: C.ink });
  y -= 22;
  page.drawText('Guide client — comprendre le suivi des pleins, du GPS et des anomalies', {
    x: MARGIN, y, size: 11, font: italic, color: C.muted,
  });
  y -= 24;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1, color: C.line });
  y -= 16;

  // ═══════════════════ 1. VUE D'ENSEMBLE ═══════════════════
  heading('1.  Vue d’ensemble');
  paragraph(
    'Le module carburant répond à trois besoins : enregistrer les pleins réels, estimer automatiquement la consommation et le coût à partir du GPS, et détecter les anomalies.',
    { after: 4 },
  );
  drawTable(
    ['Composant', 'Onglet', 'Rôle', 'Données'],
    [
      ['Saisie manuelle', 'Saisie manuelle', 'Enregistrer les pleins réels', 'Véhicule, litres, km, coût, date, notes'],
      ['Rapport GPS', 'Rapport GPS', 'Estimer consommation et coût automatiquement', 'Positions GPS + conso théorique + prix'],
      ['Prix carburant', 'Prix carburant', 'Définir les prix par type et dans le temps', 'Prix par défaut + historique daté'],
    ],
    [90, 80, 150, 180],
  );

  // ═══════════════════ 2. LES 3 ONGLETS ═══════════════════
  heading('2.  Les trois onglets en détail');
  drawTable(
    ['Élément', 'Saisie manuelle', 'Rapport GPS', 'Prix carburant'],
    [
      ['Objectif', 'Suivre les pleins réels', 'Estimer distance, consommation, coût', 'Fixer les prix de l’estimation'],
      ['Déclencheur', 'Saisie par l’équipe', 'Automatique chaque soir + bouton « Générer »', 'Saisie par l’entreprise'],
      ['Unités', 'Litres, km, coût', 'km, L/100km, coût estimé (Ar)', 'Ar/litre'],
      ['Niveau', 'Par véhicule (sélectionné)', 'Par chauffeur + véhicule + jour', 'Par type de carburant'],
    ],
    [90, 120, 175, 115],
  );

  // ═══════════════════ 3. RAPPORT GPS ═══════════════════
  heading('3.  Rapport GPS — calcul de la distance');
  drawTable(
    ['Étape', 'Action', 'Détail'],
    [
      ['1. Collecte', 'Positions GPS du jour', 'Par chauffeur et par véhicule'],
      ['2. Attribution véhicule', 'Historique d’affectation', 'Qui conduisait quoi à quel moment (même si changement de véhicule en journée)'],
      ['3. Filtre bruit', 'Déplacements < 5 m ignorés', 'Dérive GPS à l’arrêt non comptée'],
      ['4. Filtre suspect', 'Positions suspectes exclues', 'Téléportation / GPS incohérent'],
      ['5. Somme', 'Distances réelles additionnées', 'Distance fiable du trajet'],
      ['6. Coût estimé', 'km ÷ 100 × conso théorique × prix/litre', 'Chiffré avec le véhicule du groupe et le prix en vigueur à la date'],
    ],
    [95, 180, 225],
  );

  // ═══════════════════ 4. DÉTECTEURS D'ANOMALIE ═══════════════════
  heading('4.  Les deux détecteurs d’anomalie');
  drawTable(
    ['Détecteur', 'Comparaison', 'Seuil par défaut', 'Configurable', 'Exemple'],
    [
      ['Consommation', 'Conso mesurée (litres/km) vs conso théorique du véhicule', 'Écart > 20 %', 'Oui', '10 L/100km théorique, 14 mesuré = 40 % d’écart, signalé comme anomalie'],
      ['Kilométrage GPS', 'Km saisis vs km GPS sur la période', 'Ratio > 1,3 (130 %)', 'Oui', '500 km saisis vs 150 km GPS = 3,3×, signalé comme anomalie'],
    ],
    [110, 160, 90, 95, 145],
  );
  paragraph(
    'Les deux détecteurs sont indépendants : chacun signale sans écraser l’autre. Un plein peut être normal en consommation mais anormal en kilométrage, et inversement.',
    { size: 9, after: 2 },
  );

  // ═══════════════════ 5. CAS D'USAGE ═══════════════════
  heading('5.  Cas d’usage quotidiens');
  drawTable(
    ['Situation', 'Comportement du système'],
    [
      ['Plein saisi', 'Analyse consommation + comparaison GPS, signalement immédiat si écart'],
      ['Chauffeur change de véhicule en journée', 'Km attribués au bon véhicule (historique d’affectation)'],
      ['Prix du carburant change', 'Anciens rapports chiffrés avec l’ancien prix (historique daté)'],
      ['Aucun mouvement GPS (véhicule à l’arrêt)', 'Rapport conservé avec distance 0 (pas de trou dans le suivi)'],
      ['Anomalie détectée', 'Badge rouge dans la liste + notification'],
    ],
    [200, 300],
  );

  // ═══════════════════ 6. STATISTIQUES ═══════════════════
  heading('6.  Statistiques affichées');
  drawTable(
    ['Indicateur', 'Source'],
    [
      ['Litres totalisés', 'Somme des pleins'],
      ['Km totalisés', 'Somme des distances saisies'],
      ['Coût total', 'Somme des coûts'],
      ['Consommation moyenne (L/100km)', 'Litres ÷ km × 100'],
      ['Nombre d’anomalies', 'Comptage des signalements'],
    ],
    [200, 300],
  );

  // ═══════════════════ 7. ARGUMENTS CLÉS ═══════════════════
  heading('7.  Arguments clés');
  drawTable(
    ['Argument', 'Valeur'],
    [
      ['Double source de vérité', 'Pleins réels + estimation GPS qui se recoupent'],
      ['Anti-fraude / anti-erreur', 'Seuils à 20 % (consommation) et 30 % (kilométrage) — un écart de 2× est impossible à masquer'],
      ['Précision', 'Bruit GPS filtré, points suspects exclus, attribution correcte par véhicule à l’instant T'],
      ['Tarification juste', 'Prix historique appliqué à la date du rapport'],
      ['Configuration', 'Tous les seuils et prix sont modifiables par l’entreprise'],
    ],
    [180, 320],
  );

  footer();

  const bytes = await doc.save();
  fs.writeFileSync(process.argv[2], bytes);
  console.log('PDF généré :', process.argv[2], `(${(bytes.length / 1024).toFixed(1)} Ko, ${doc.getPageCount()} page(s))`);
})().catch((e) => {
  console.error('Erreur :', e);
  process.exit(1);
});
