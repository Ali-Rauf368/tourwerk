import { predictTour, type EtaStop, type TourSnapshot } from '../src/services/eta';

const depot = { lat: 53.5378, lng: 10.0868, shiftStart: 420 };
const stop = (seq: number, over: Partial<EtaStop> = {}): EtaStop => ({
  id: `s${seq}`,
  seq,
  etaMin: 420 + seq * 30,
  status: 'PENDING',
  completedMin: null,
  lat: 53.55 + seq * 0.01,
  lng: 10.0 + seq * 0.005,
  serviceMin: 5,
  windowStart: 420,
  windowEnd: 1080,
  number: `TW-${seq}`,
  customer: `C${seq}`,
  ...over,
});
const tour = (stops: EtaStop[]): TourSnapshot => ({ tourId: 't1', vehicleId: 'v1', depot, stops });

describe('ETA prediction', () => {
  test('a tour that has not started yet is forecast from the depot at plan pace', () => {
    const p = predictTour(tour([stop(1), stop(2), stop(3)]), null);
    expect(p.pace).toBe(1);
    expect(p.clockMin).toBe(420);
    expect(p.stops.map((s) => s.seq)).toEqual([1, 2, 3]);
    expect(p.stops.every((s, i, all) => i === 0 || s.predictedMin > all[i - 1].predictedMin)).toBe(true);
    expect(p.late).toBe(0);
    expect(p.predictedReturn).toBeGreaterThan(p.stops[2].predictedMin);
  });

  test('a van running behind learns a slower pace and flags windows it will miss', () => {
    const stops = [
      stop(1, { status: 'DELIVERED', etaMin: 440, completedMin: 470 }),
      stop(2, { status: 'DELIVERED', etaMin: 470, completedMin: 520 }),
      stop(3, { status: 'DELIVERED', etaMin: 500, completedMin: 575 }),
      stop(4, { windowEnd: 590 }),
      stop(5, { windowEnd: 800 }),
    ];
    const p = predictTour(tour(stops), null);
    expect(p.pace).toBeGreaterThan(1.2);
    expect(p.clockMin).toBe(575);
    expect(p.stops.map((s) => s.id)).toEqual(['s4', 's5']);
    expect(p.stops[0].risk).not.toBe('ok');
    expect(p.delayMin).toBeGreaterThan(0);
  });

  test('the live position and simulated clock take precedence; arrived stops are served now', () => {
    const p = predictTour(tour([stop(1, { status: 'ARRIVED', windowEnd: 700 }), stop(2, { windowEnd: 697 })]), { lat: 53.56, lng: 10.005, clockMin: 690 });
    expect(p.stops[0]).toMatchObject({ predictedMin: 690, slackMin: 10, risk: 'tight' });
    expect(p.stops[1].risk).toBe('late');
    expect(p.late).toBe(1);
    expect(p.tight).toBe(1);
  });

  test('a stop is never predicted before its window opens', () => {
    const p = predictTour(tour([stop(1, { windowStart: 840, windowEnd: 960 })]), null);
    expect(p.stops[0].predictedMin).toBe(840);
  });
});
