#include "vrp.hpp"

#include <algorithm>
#include <cmath>
#include <numeric>

namespace tw {

double haversineKm(Point a, Point b) {
  constexpr double R = 6371.0, rad = M_PI / 180.0;
  const double dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const double h = std::sin(dLat / 2) * std::sin(dLat / 2) +
                   std::cos(a.lat * rad) * std::cos(b.lat * rad) * std::sin(dLng / 2) * std::sin(dLng / 2);
  return 2 * R * std::asin(std::sqrt(h));
}

Solver::Solver(Problem p) : p_(std::move(p)) {
  const size_t n = p_.orders.size() + 1;
  std::vector<Point> nodes{p_.depot};
  for (const auto& o : p_.orders) nodes.push_back(o.at);
  dist_.assign(n, std::vector<double>(n, 0.0));
  for (size_t i = 0; i < n; ++i)
    for (size_t j = i + 1; j < n; ++j) dist_[i][j] = dist_[j][i] = haversineKm(nodes[i], nodes[j]) * p_.detourFactor;
}

double Solver::travelKm(int from, int to) const { return dist_[from][to]; }

int Solver::travelMin(int from, int to) const {
  return static_cast<int>(std::ceil(dist_[from][to] / p_.speedKmh * 60.0));
}

double Solver::routeKm(const std::vector<int>& stops) const {
  if (stops.empty()) return 0;
  double km = dist_[0][stops.front() + 1] + dist_[stops.back() + 1][0];
  for (size_t i = 1; i < stops.size(); ++i) km += dist_[stops[i - 1] + 1][stops[i] + 1];
  return km;
}

bool Solver::evaluate(Route& r) const {
  r.visits.clear();
  r.loadKg = 0;
  int t = p_.shiftStart, prev = 0;
  for (int o : r.stops) {
    const Order& ord = p_.orders[o];
    r.loadKg += ord.weightKg;
    t += travelMin(prev, o + 1);
    if (t < ord.windowStart) t = ord.windowStart;  // wait for the window to open
    if (t > ord.windowEnd) return false;
    r.visits.push_back({o, t});
    t += ord.serviceMin;
    prev = o + 1;
  }
  t += travelMin(prev, 0);
  r.returnMin = t;
  r.distanceKm = routeKm(r.stops);
  const double cap = r.vehicle >= 0 ? p_.vehicles[r.vehicle].capacityKg : 1e18;
  return r.loadKg <= cap + 1e-9 && t <= p_.shiftEnd;
}

bool Solver::twoOpt(Route& r) const {
  bool improved = false, again = true;
  while (again) {
    again = false;
    for (size_t i = 0; i + 1 < r.stops.size(); ++i) {
      for (size_t k = i + 1; k < r.stops.size(); ++k) {
        Route cand = r;
        std::reverse(cand.stops.begin() + static_cast<long>(i), cand.stops.begin() + static_cast<long>(k) + 1);
        if (routeKm(cand.stops) + 1e-9 < r.distanceKm && evaluate(cand)) {
          r = std::move(cand);
          improved = again = true;
        }
      }
    }
  }
  return improved;
}

bool Solver::relocate(std::vector<Route>& routes) const {
  for (size_t a = 0; a < routes.size(); ++a) {
    for (size_t i = 0; i < routes[a].stops.size(); ++i) {
      const int o = routes[a].stops[i];
      Route src = routes[a];
      src.stops.erase(src.stops.begin() + static_cast<long>(i));
      if (!evaluate(src)) continue;
      const double before0 = routes[a].distanceKm;
      for (size_t b = 0; b < routes.size(); ++b) {
        if (a == b) continue;
        for (size_t pos = 0; pos <= routes[b].stops.size(); ++pos) {
          Route dst = routes[b];
          dst.stops.insert(dst.stops.begin() + static_cast<long>(pos), o);
          if (!evaluate(dst)) continue;
          const double gain = before0 + routes[b].distanceKm - src.distanceKm - dst.distanceKm;
          if (gain > 1e-6) {
            routes[a] = src;
            routes[b] = dst;
            return true;
          }
        }
      }
    }
  }
  return false;
}

// Cheapest feasible insertion of leftover orders into any route, including empty
// routes for vehicles that are still idle. Tightest time windows go first.
void Solver::insertUnassigned(std::vector<Route>& routes, std::vector<int>& unassigned) const {
  std::vector<bool> used(p_.vehicles.size(), false);
  for (const auto& r : routes) used[r.vehicle] = true;
  for (size_t v = 0; v < p_.vehicles.size(); ++v)
    if (!used[v]) {
      Route r;
      r.vehicle = static_cast<int>(v);
      evaluate(r);
      routes.push_back(r);
    }
  std::sort(unassigned.begin(), unassigned.end(), [&](int a, int b) {
    return p_.orders[a].windowEnd - p_.orders[a].windowStart < p_.orders[b].windowEnd - p_.orders[b].windowStart;
  });
  std::vector<int> still;
  for (int o : unassigned) {
    double best = 1e18;
    Route bestRoute;
    size_t bestIdx = 0;
    for (size_t ri = 0; ri < routes.size(); ++ri) {
      for (size_t pos = 0; pos <= routes[ri].stops.size(); ++pos) {
        Route cand = routes[ri];
        cand.stops.insert(cand.stops.begin() + static_cast<long>(pos), o);
        if (!evaluate(cand)) continue;
        const double delta = cand.distanceKm - routes[ri].distanceKm;
        if (delta < best) {
          best = delta;
          bestRoute = cand;
          bestIdx = ri;
        }
      }
    }
    if (best < 1e17) routes[bestIdx] = bestRoute;
    else still.push_back(o);
  }
  unassigned = still;
}

Solution Solver::solve() {
  const int n = static_cast<int>(p_.orders.size());
  Solution sol;
  double maxCap = 0;
  for (const auto& v : p_.vehicles) maxCap = std::max(maxCap, v.capacityKg);

  // 1. One route per order (orders that cannot be served alone are unassigned).
  std::vector<Route> routes;
  std::vector<int> routeOf(n, -1);
  for (int i = 0; i < n; ++i) {
    Route r;
    r.stops = {i};
    if (p_.orders[i].weightKg > maxCap || !evaluate(r)) {
      sol.unassigned.push_back(i);
      continue;
    }
    routeOf[i] = static_cast<int>(routes.size());
    routes.push_back(r);
  }

  // 2. Clarke–Wright savings s(i,j) = d(0,i) + d(0,j) − d(i,j), largest first.
  struct Saving {
    int i, j;
    double s;
  };
  std::vector<Saving> savings;
  for (int i = 0; i < n; ++i)
    for (int j = i + 1; j < n; ++j)
      if (routeOf[i] >= 0 && routeOf[j] >= 0)
        savings.push_back({i, j, dist_[0][i + 1] + dist_[0][j + 1] - dist_[i + 1][j + 1]});
  std::sort(savings.begin(), savings.end(), [](const Saving& x, const Saving& y) { return x.s > y.s; });

  std::vector<bool> alive(routes.size(), true);
  for (const auto& sv : savings) {
    if (sv.s <= 0) break;
    const int ra = routeOf[sv.i], rb = routeOf[sv.j];
    if (ra == rb) continue;
    // Try the four end-to-end joins; i and j must be route ends.
    const auto tryJoin = [&](std::vector<int> a, std::vector<int> b) {
      if (a.back() != sv.i && a.back() != sv.j) return false;
      if (b.front() != sv.i && b.front() != sv.j) return false;
      Route m;
      m.stops = a;
      m.stops.insert(m.stops.end(), b.begin(), b.end());
      if (m.stops.size() < 2 || !evaluate(m) || m.loadKg > maxCap) return false;
      routes[ra] = m;
      alive[rb] = false;
      for (int o : m.stops) routeOf[o] = ra;
      return true;
    };
    std::vector<int> A = routes[ra].stops, B = routes[rb].stops, Ar(A.rbegin(), A.rend()), Br(B.rbegin(), B.rend());
    tryJoin(A, B) || tryJoin(A, Br) || tryJoin(Ar, B) || tryJoin(Ar, Br);
  }
  std::vector<Route> merged;
  for (size_t r = 0; r < routes.size(); ++r)
    if (alive[r]) merged.push_back(routes[r]);

  // 3. Assign vehicles: heaviest routes to the largest vehicles; routes beyond the fleet stay unassigned.
  std::sort(merged.begin(), merged.end(), [](const Route& x, const Route& y) { return x.loadKg > y.loadKg; });
  std::vector<int> vIdx(p_.vehicles.size());
  std::iota(vIdx.begin(), vIdx.end(), 0);
  std::sort(vIdx.begin(), vIdx.end(), [&](int a, int b) { return p_.vehicles[a].capacityKg > p_.vehicles[b].capacityKg; });
  std::vector<Route> assigned;
  for (size_t k = 0; k < merged.size(); ++k) {
    Route r = merged[k];
    bool ok = false;
    if (k < vIdx.size()) {
      r.vehicle = vIdx[k];
      ok = evaluate(r);
    }
    if (ok) assigned.push_back(r);
    else sol.unassigned.insert(sol.unassigned.end(), r.stops.begin(), r.stops.end());
  }

  // 4. Repair: place leftovers by cheapest feasible insertion (also opens idle vehicles).
  insertUnassigned(assigned, sol.unassigned);
  for (const auto& r : assigned) sol.initialKm += r.distanceKm;

  // 5. Adaptive large neighbourhood search (only with a time or iteration budget).
  alns(assigned, sol.unassigned, sol);

  // 6. Polish with classic local search.
  for (auto& r : assigned) sol.improvements += twoOpt(r) ? 1 : 0;
  for (int guard = 0; guard < 500 && relocate(assigned); ++guard) ++sol.improvements;
  for (auto& r : assigned) {
    sol.improvements += twoOpt(r) ? 1 : 0;
    evaluate(r);
  }
  assigned.erase(std::remove_if(assigned.begin(), assigned.end(), [](const Route& r) { return r.stops.empty(); }), assigned.end());

  for (const auto& r : assigned) sol.totalKm += r.distanceKm;
  if (!sol.trace.empty() && sol.totalKm < sol.trace.back().bestKm - 1e-6)
    sol.trace.push_back({sol.iterations, sol.trace.back().ms, sol.totalKm, static_cast<int>(sol.unassigned.size())});
  std::sort(sol.unassigned.begin(), sol.unassigned.end());
  sol.routes = std::move(assigned);
  return sol;
}

}  // namespace tw
