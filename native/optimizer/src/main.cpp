// tw-optimizer: reads one problem from stdin, writes the plan to stdout.
//
// Input (one record per line, whitespace separated):
//   DEPOT <lat> <lng> <shiftStartMin> <shiftEndMin> <speedKmh>
//   VEHICLE <id> <capacityKg>
//   ORDER <id> <lat> <lng> <weightKg> <serviceMin> <windowStartMin> <windowEndMin>
//   PARAMS <timeLimitMs> <maxIterations> <seed>      (optional; enables the ALNS search)
//   SOLVE
// Output:
//   ROUTE <vehicleId> <distanceKm> <returnMin> <loadKg> <orderId>@<etaMin> ...
//   UNASSIGNED <orderId>
//   TRACE <iteration> <ms> <bestKm> <unassigned>    (each new best found by the search)
//   OP <name> <weight> <uses> <newBest>              (adaptive operator statistics)
//   STATS <totalKm> <improvements> <elapsedMs> <iterations> <initialKm>
//   OK
// Errors: "ERR <message>" followed by OK. The process handles problems until EOF.
#include <chrono>
#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>

#include "vrp.hpp"

int main() {
  std::ios::sync_with_stdio(false);
  tw::Problem p;
  std::string line;
  while (std::getline(std::cin, line)) {
    std::istringstream in(line);
    std::string cmd;
    if (!(in >> cmd)) continue;
    if (cmd == "DEPOT") {
      if (!(in >> p.depot.lat >> p.depot.lng >> p.shiftStart >> p.shiftEnd >> p.speedKmh)) std::cout << "ERR bad DEPOT\n";
    } else if (cmd == "VEHICLE") {
      tw::Vehicle v;
      if (in >> v.id >> v.capacityKg) p.vehicles.push_back(v);
      else std::cout << "ERR bad VEHICLE\n";
    } else if (cmd == "ORDER") {
      tw::Order o;
      if (in >> o.id >> o.at.lat >> o.at.lng >> o.weightKg >> o.serviceMin >> o.windowStart >> o.windowEnd) p.orders.push_back(o);
      else std::cout << "ERR bad ORDER\n";
    } else if (cmd == "PARAMS") {
      if (!(in >> p.timeLimitMs >> p.maxIterations >> p.seed) || p.timeLimitMs < 0 || p.timeLimitMs > 60000 || p.maxIterations < 0)
        std::cout << "ERR bad PARAMS\n";
    } else if (cmd == "SOLVE") {
      const auto t0 = std::chrono::steady_clock::now();
      tw::Solver solver(p);
      const tw::Solution s = solver.solve();
      const long ms = static_cast<long>(
          std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count());
      char buf[96];
      for (const auto& r : s.routes) {
        std::snprintf(buf, sizeof buf, "ROUTE %s %.3f %d %.2f", p.vehicles[r.vehicle].id.c_str(), r.distanceKm, r.returnMin, r.loadKg);
        std::cout << buf;
        for (const auto& v : r.visits) std::cout << ' ' << p.orders[v.order].id << '@' << v.eta;
        std::cout << '\n';
      }
      for (int u : s.unassigned) std::cout << "UNASSIGNED " << p.orders[u].id << '\n';
      for (const auto& t : s.trace) {
        std::snprintf(buf, sizeof buf, "TRACE %d %ld %.3f %d", t.iteration, t.ms, t.bestKm, t.unassigned);
        std::cout << buf << '\n';
      }
      for (const auto& o : s.operators) {
        std::snprintf(buf, sizeof buf, "OP %s %.4f %d %d", o.name.c_str(), o.weight, o.uses, o.newBest);
        std::cout << buf << '\n';
      }
      std::snprintf(buf, sizeof buf, "STATS %.3f %d %ld %d %.3f", s.totalKm, s.improvements, ms, s.iterations, s.initialKm);
      std::cout << buf << "\nOK\n" << std::flush;
      p = tw::Problem{};
    } else {
      std::cout << "ERR unknown command " << cmd << "\nOK\n" << std::flush;
    }
  }
  return 0;
}
