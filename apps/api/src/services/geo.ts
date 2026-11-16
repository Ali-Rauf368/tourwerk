import { createHash } from 'node:crypto';

/**
 * Offline geocoding for the Hamburg service area. A production deployment would call a
 * geocoding API; here each postcode maps to its approximate centroid and the street
 * spreads addresses deterministically (same address → same point) within ~600 m.
 */
export const POSTCODES: Record<string, { district: string; lat: number; lng: number }> = {
  '20095': { district: 'Altstadt', lat: 53.5507, lng: 10.0006 },
  '20354': { district: 'Neustadt', lat: 53.5578, lng: 9.9862 },
  '20457': { district: 'HafenCity', lat: 53.5413, lng: 9.9947 },
  '22767': { district: 'Altona-Altstadt', lat: 53.5488, lng: 9.9446 },
  '22765': { district: 'Ottensen', lat: 53.5539, lng: 9.9246 },
  '20357': { district: 'Sternschanze', lat: 53.5636, lng: 9.9654 },
  '20259': { district: 'Eimsbüttel', lat: 53.5745, lng: 9.9535 },
  '20249': { district: 'Eppendorf', lat: 53.5893, lng: 9.9862 },
  '22303': { district: 'Winterhude', lat: 53.5903, lng: 10.0213 },
  '22081': { district: 'Barmbek-Süd', lat: 53.5749, lng: 10.0436 },
  '22083': { district: 'Barmbek-Nord', lat: 53.5862, lng: 10.0443 },
  '22087': { district: 'Hohenfelde', lat: 53.5625, lng: 10.0273 },
  '20099': { district: 'St. Georg', lat: 53.5552, lng: 10.0151 },
  '22089': { district: 'Eilbek', lat: 53.5712, lng: 10.0589 },
  '22041': { district: 'Wandsbek', lat: 53.5729, lng: 10.0805 },
  '20537': { district: 'Hamm', lat: 53.5537, lng: 10.0569 },
  '22111': { district: 'Horn', lat: 53.5534, lng: 10.0892 },
  '20539': { district: 'Rothenburgsort', lat: 53.5352, lng: 10.0436 },
  '21107': { district: 'Wilhelmsburg', lat: 53.4987, lng: 10.0109 },
  '22525': { district: 'Stellingen', lat: 53.5893, lng: 9.9318 },
  '22297': { district: 'Alsterdorf', lat: 53.6061, lng: 10.0034 },
  '22049': { district: 'Dulsberg', lat: 53.5791, lng: 10.0671 },
  '22113': { district: 'Billstedt', lat: 53.5401, lng: 10.1213 },
  '22605': { district: 'Othmarschen', lat: 53.5525, lng: 9.8980 },
};

export function geocode(street: string, postcode: string): { lat: number; lng: number } | null {
  const c = POSTCODES[postcode];
  if (!c) return null;
  const h = createHash('sha1').update(street.trim().toLowerCase()).digest();
  const dLat = (h.readUInt16BE(0) / 65535 - 0.5) * 0.009; // ±~500 m
  const dLng = (h.readUInt16BE(2) / 65535 - 0.5) * 0.014;
  return { lat: +(c.lat + dLat).toFixed(6), lng: +(c.lng + dLng).toFixed(6) };
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export const minutesToClock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
