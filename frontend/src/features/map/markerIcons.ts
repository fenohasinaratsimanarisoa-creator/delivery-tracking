import L from 'leaflet';
import icon from 'leaflet/dist/images/marker-icon.png';
import icon2x from 'leaflet/dist/images/marker-icon-2x.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

/**
 * Marqueur Leaflet par défaut en version @2x sur écrans HiDPI (Retina/4K).
 *
 * marker-icon-2x.png (50×82) est affiché en 25×41 CSS → net, sans étirement
 * flou de l'image 1x. Sur un écran dpr=1 Leaflet garde marker-icon.png
 * (détection native via Browser.retina, aucun sur-fetch).
 *
 * Remplaçe l'ancien pattern `L.icon({ iconUrl: marker-icon.png, iconSize:
 * [25, 41] })` qui chargeait TOUJOURS l'image 1x, floue sur tout écran
 * haute densité. À appeler une fois au chargement du module de la page.
 */
export function enableRetinaDefaultMarker(): void {
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: icon2x,
    iconUrl: icon,
    shadowUrl: iconShadow,
  });
}

// Pin SVG inline (vectoriel, net à toute taille/zoom) pour les points
// pickup/livraison — remplace les PNG raster hébergés sur GitHub (25×41, sans
// variante @2x, dépendance externe). Contour blanc + ombre portée pour rester
// lisible sur toute couche (clair/sombre/satellite). Couleur = token CSS
// passé par l'appelant (ex. var(--color-red)).
const PIN_PATH =
  'M14 1.8 C8.9 1.8 4.8 5.9 4.8 11 C4.8 17 14 38.2 14 38.2 C14 38.2 23.2 17 23.2 11 C23.2 5.9 19.1 1.8 14 1.8 Z';

export function createPinIcon(colorToken: string): L.DivIcon {
  return L.divIcon({
    className: 'dt-pin-marker',
    html: `<svg width="28" height="40" viewBox="0 0 28 40" fill="none" aria-hidden="true" style="color:${colorToken};filter:drop-shadow(0 2px 3px rgba(0,0,0,0.35))"><path d="${PIN_PATH}" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="3" stroke-linejoin="round"/><path d="${PIN_PATH}" fill="currentColor"/><circle cx="14" cy="10.6" r="3.2" fill="#FFFFFF"/></svg>`,
    iconSize: [28, 40],
    iconAnchor: [14, 38],
    popupAnchor: [0, -36],
  });
}
