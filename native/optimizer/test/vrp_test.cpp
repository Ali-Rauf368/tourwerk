// Minimal self-contained tests for the optimizer (no framework needed).
#include <chrono>
#include <cmath>
#include <cstdio>
#include <set>

#include "../src/vrp.hpp"

static int failures = 0;
#define CHECK(cond)                                                    \
  do {                                                                 \
    if (!(cond)) {                                                     \
      std::printf("  FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);    \
      ++failures;                                                      \
    }                                                                  \
  } while (0)

static tw::Problem cityProblem(int orders, int vehicles, double cap) {
  tw::Problem p;
  p.depot = {53.53, 10.08};
  for (int v = 0; v < vehicles; ++v) p.vehicles.push_back({"V" + std::to_string(v), cap});
  unsigned seed = 42;
  auto rnd = [&] { return (seed = seed * 1103515245u + 12345u) / 4294967296.0; };
  for (int i = 0; i < orders; ++i)
    p.orders.push_back({"O" + std::to_string(i), {53.50 + rnd() * 0.12, 9.90 + rnd() * 0.25}, 5 + rnd() * 20, 4, 7 * 60, 19 * 60});
  return p;
}

static void testHaversine() {
  // Hamburg Rathaus → Berlin Brandenburger Tor ≈ 255 km.
  const double d = tw::haversineKm({53.5507, 9.9930}, {52.5163, 13.3777});
  CHECK(std::fabs(d - 255.0) < 5.0);
  CHECK(tw::haversineKm({53.5, 10.0}, {53.5, 10.0}) == 0.0);
}

static void testEveryOrderOnceAndCapacity() {
  tw::Problem p = cityProblem(60, 6, 250);
  tw::Solver s(p);
  const tw::Solution sol = s.solve();
  std::multiset<int> seen;
  for (const auto& r : sol.routes) {
    CHECK(r.loadKg <= p.vehicles[r.vehicle].capacityKg + 1e-9);
    CHECK(r.returnMin <= p.shiftEnd);
    for (int o : r.stops) seen.insert(o);
  }
  for (int u : sol.unassigned) seen.insert(u);
  CHECK(seen.size() == p.orders.size());
  for (int i = 0; i < 60; ++i) CHECK(seen.count(i) == 1);
  std::set<int> vehicles;
  for (const auto& r : sol.routes) vehicles.insert(r.vehicle);
  CHECK(vehicles.size() == sol.routes.size());  // one route per vehicle
}

static void testBeatsNaive() {
  tw::Problem p = cityProblem(40, 4, 1000);
  tw::Solver s(p);
  double naive = 0;  // depot → order → depot for every order
  for (size_t i = 0; i < p.orders.size(); ++i) naive += 2 * s.travelKm(0, static_cast<int>(i) + 1);
  const tw::Solution sol = s.solve();
  CHECK(sol.unassigned.empty());
  CHECK(sol.totalKm < naive * 0.5);
}

static void testTimeWindows() {
  tw::Problem p = cityProblem(20, 3, 1000);
  p.orders[3].windowStart = 14 * 60;
  p.orders[3].windowEnd = 14 * 60 + 30;
  p.orders[7].windowStart = 7 * 60;
  p.orders[7].windowEnd = 8 * 60;
  tw::Solver s(p);
  const tw::Solution sol = s.solve();
  for (const auto& r : sol.routes)
    for (const auto& v : r.visits) {
      CHECK(v.eta >= p.orders[v.order].windowStart);
      CHECK(v.eta <= p.orders[v.order].windowEnd);
    }
}

static void testImpossibleOrdersUnassigned() {
  tw::Problem p = cityProblem(5, 1, 100);
  p.orders[0].weightKg = 500;  // heavier than any vehicle
  p.orders[1].windowStart = 5 * 60;
  p.orders[1].windowEnd = 5 * 60 + 10;  // before the shift starts
  tw::Solver s(p);
  const tw::Solution sol = s.solve();
  CHECK(sol.unassigned.size() >= 2);
  CHECK(sol.unassigned[0] == 0 && sol.unassigned[1] == 1);
}

static void testFleetLimit() {
  tw::Problem p = cityProblem(30, 1, 60);  // one small van cannot carry everything
  tw::Solver s(p);
  const tw::Solution sol = s.solve();
  CHECK(sol.routes.size() == 1);
  CHECK(!sol.unassigned.empty());
}

static tw::Problem twProblem(int orders, int vehicles, double cap) {
  tw::Problem p = cityProblem(orders, vehicles, cap);
  const int windows[][2] = {{480, 720}, {540, 660}, {720, 960}, {840, 1080}, {420, 1140}};
  for (size_t i = 0; i < p.orders.size(); ++i) {
    p.orders[i].windowStart = windows[i % 5][0];
    p.orders[i].windowEnd = windows[i % 5][1];
  }
  return p;
}

static void checkFeasible(const tw::Problem& p, const tw::Solution& sol) {
  std::multiset<int> seen;
  for (const auto& r : sol.routes) {
    CHECK(r.loadKg <= p.vehicles[r.vehicle].capacityKg + 1e-9);
    CHECK(r.returnMin <= p.shiftEnd);
    for (const auto& v : r.visits) {
      CHECK(v.eta >= p.orders[v.order].windowStart);
      CHECK(v.eta <= p.orders[v.order].windowEnd);
    }
    for (int o : r.stops) seen.insert(o);
  }
  for (int u : sol.unassigned) seen.insert(u);
  CHECK(seen.size() == p.orders.size());
  for (size_t i = 0; i < p.orders.size(); ++i) CHECK(seen.count(static_cast<int>(i)) == 1);
}

static void testAlnsImprovesAndStaysFeasible() {
  tw::Problem base = twProblem(70, 6, 260);
  tw::Solution plain = tw::Solver(base).solve();
  tw::Problem p = base;
  p.maxIterations = 1500;
  p.seed = 7;
  tw::Solution sol = tw::Solver(p).solve();
  checkFeasible(p, sol);
  CHECK(sol.iterations == 1500);
  CHECK(sol.unassigned.size() <= plain.unassigned.size());
  if (sol.unassigned.size() == plain.unassigned.size()) CHECK(sol.totalKm <= plain.totalKm + 1e-6);
  CHECK(sol.trace.size() >= 2);
  for (size_t i = 1; i < sol.trace.size(); ++i)  // best never gets worse
    CHECK(sol.trace[i].unassigned < sol.trace[i - 1].unassigned ||
          (sol.trace[i].unassigned == sol.trace[i - 1].unassigned && sol.trace[i].bestKm <= sol.trace[i - 1].bestKm + 1e-6));
  CHECK(sol.operators.size() == 5);
  std::printf("  alns: construction %.1f km -> %.1f km after %d iterations (%zu unassigned)\n", sol.initialKm, sol.totalKm, sol.iterations, sol.unassigned.size());
}

static void testAlnsDeterministic() {
  tw::Problem p = twProblem(40, 4, 300);
  p.maxIterations = 400;
  p.seed = 3;
  const tw::Solution a = tw::Solver(p).solve(), b = tw::Solver(p).solve();
  CHECK(std::fabs(a.totalKm - b.totalKm) < 1e-9);
  CHECK(a.routes.size() == b.routes.size());
}

static void testAlnsTimeLimit() {
  tw::Problem p = twProblem(60, 5, 300);
  p.timeLimitMs = 150;
  const auto t0 = std::chrono::steady_clock::now();
  const tw::Solution sol = tw::Solver(p).solve();
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count();
  checkFeasible(p, sol);
  CHECK(sol.iterations > 0);
  CHECK(ms < 1000);
}

int main() {
  testHaversine();
  testEveryOrderOnceAndCapacity();
  testBeatsNaive();
  testTimeWindows();
  testImpossibleOrdersUnassigned();
  testFleetLimit();
  testAlnsImprovesAndStaysFeasible();
  testAlnsDeterministic();
  testAlnsTimeLimit();
  if (failures) {
    std::printf("optimizer tests: %d failure(s)\n", failures);
    return 1;
  }
  std::printf("optimizer tests: all passed\n");
  return 0;
}
