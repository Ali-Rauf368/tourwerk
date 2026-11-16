export type Role = 'ADMIN' | 'DISPATCHER' | 'DRIVER';
export interface User { id: string; name: string; email: string; role: Role; vehicle: { id: string; plate: string } | null }
export type OrderStatus = 'NEW' | 'PLANNED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'CANCELLED';
export interface Order {
  id: string; number: string; status: OrderStatus; source: string; customer: string; phone: string | null; street: string; postcode: string; city: string;
  lat: number; lng: number; weightKg: number; parcels: number; windowStart: number; windowEnd: number; deliveryDay: string; note: string | null; failReason: string | null;
  stop?: { seq: number; etaMin: number; completedMin: number | null; tour: { id: string; vehicle: { plate: string } } } | null;
}
export interface Vehicle { id: string; plate: string; label: string; capacityKg: number; electric: boolean; active: boolean; driver: { id: string; name: string } | null }
export interface Depot { id: string; name: string; address: string; lat: number; lng: number; shiftStart: number; shiftEnd: number }
export interface Stop { id: string; seq: number; etaMin: number; status: 'PENDING' | 'ARRIVED' | 'DELIVERED' | 'FAILED'; completedMin: number | null; order: Order }
export interface Tour {
  id: string; day: string; status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED'; plannedKm: number; drivenKm: number | null; plannedReturn: number; loadKg: number;
  optimizerEngine: string; vehicle: Vehicle; depot: Depot; stops: Stop[]; simulating?: boolean;
}
export interface PlanStop { orderId: string; etaMin: number; number: string; customer: string; street: string; postcode: string; lat: number; lng: number; weightKg: number; windowStart: number; windowEnd: number }
export interface PlanRoute { vehicleId: string; distanceKm: number; returnMin: number; loadKg: number; utilization: number; vehicle: Vehicle; stops: PlanStop[] }
export interface PlanSearch {
  iterations: number; initialKm: number;
  trace: { iteration: number; ms: number; bestKm: number; unassigned: number }[];
  operators: { name: string; weight: number; uses: number; newBest: number }[];
}
export interface Plan {
  day: string; depot: Depot; engine: 'native' | 'typescript'; elapsedMs: number; improvements: number; search: PlanSearch; totalKm: number; baselineKm: number; vehiclesAvailable: number;
  routes: PlanRoute[]; unassigned: { id: string; number: string; customer: string; weightKg: number; windowStart: number; windowEnd: number; lat: number; lng: number }[];
}
export interface Summary {
  day: string; orders: { total: number; unplanned: number; open: number; delivered: number; failed: number; weightKg: number; parcels: number };
  successRate: number | null; onTimeRate: number | null; tours: { total: number; active: number }; plannedKm: number; drivenKm: number; utilization: number | null; co2SavedKg: number;
}
export interface TrendRow { day: string; delivered: number; failed: number; onTimeRate: number | null; km: number }
export interface Position { vehicleId: string; tourId: string; lat: number; lng: number; speedKmh: number; heading: number; nextSeq: number; clockMin: number }
export type Risk = 'ok' | 'tight' | 'late';
export interface Prediction {
  tourId: string; vehicleId: string; clockMin: number; pace: number; delayMin: number; predictedReturn: number; late: number; tight: number;
  stops: { id: string; seq: number; number: string; customer: string; plannedMin: number; predictedMin: number; windowEnd: number; slackMin: number; risk: Risk }[];
}
export interface Scenario { vans: number; vansUsed: number; plates: string[]; totalKm: number; unassigned: number; lastReturn: number | null; utilization: number; costEur: number }
export interface ScenarioResult { day: string; orders: number; cost: { perVanDay: number; perKm: number; perUnassigned: number }; scenarios: Scenario[]; recommended: number | null }
export interface Tracking {
  number: string; status: OrderStatus; street: string; postcode: string; city: string; parcels: number; deliveryDay: string;
  window: { start: number; end: number }; depot: { lat: number; lng: number }; destination: { lat: number; lng: number };
  completedMin: number | null; failReason: string | null; driver: string | null; vehicle: { plate: string; electric: boolean } | null;
  plannedEta: { start: number; end: number } | null; stopsBefore: number | null; eta: { start: number; end: number; risk: Risk } | null;
  van: { lat: number; lng: number; heading: number } | null;
}
