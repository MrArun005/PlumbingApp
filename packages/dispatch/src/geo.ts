/**
 * Distance and ETA, kept deliberately simple and pure.
 *
 * Production dispatch will call the Google Distance Matrix API for road ETAs,
 * but that is I/O and belongs in the runtime layer. This module gives the
 * ranking function a deterministic default so the whole engine stays
 * simulatable — and so a Maps outage degrades to "slightly worse ordering"
 * rather than "no dispatch at all".
 */
import type { LatLng } from './types';

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Bengaluru traffic is the reason this is not just distance/speed. The
 * detour factor accounts for the fact that road distance exceeds straight-line
 * distance, and the fixed overhead covers parking, gates, lifts and finding the
 * flat — which on a 2 km job is most of the time.
 *
 * Calibrate these two numbers against real completed jobs before launch;
 * they are the single biggest lever on ETA accuracy.
 * TODO(calibrate): replace with observed medians per zone once we have 100 jobs.
 */
export const ROAD_DETOUR_FACTOR = 1.35;
export const CITY_SPEED_KMPH = 18;
export const FIXED_OVERHEAD_MINUTES = 6;

export function estimateEtaMinutes(distanceMeters: number): number {
  const roadMeters = distanceMeters * ROAD_DETOUR_FACTOR;
  const travelMinutes = (roadMeters / 1000 / CITY_SPEED_KMPH) * 60;
  return travelMinutes + FIXED_OVERHEAD_MINUTES;
}
