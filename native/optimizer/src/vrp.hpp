// Tourwerk route optimizer: capacitated vehicle routing with time windows (CVRPTW).
//
// 1. Construction: Clarke–Wright savings, merging only when capacity and every time
//    window on the merged route still hold; leftovers by cheapest feasible insertion.
// 2. Search: Adaptive Large Neighbourhood Search (Ropke & Pisinger 2006). Each iteration
//    ruins part of the solution with one of three destroy operators (random, worst-detour,
//    Shaw/related) and rebuilds it with greedy or regret-2 insertion. Operators are picked
//    by roulette wheel and their weights adapt to how often they find better solutions;
//    acceptance is simulated annealing with an exponential cooling schedule.
// 3. Polish: 2-opt inside each route and relocation of single stops between routes.
#pragma once
#include <string>
#include <vector>

namespace tw {

struct Point {
  double lat = 0, lng = 0;
};

struct Order {
  std::string id;
  Point at;
  double weightKg = 0;
  int serviceMin = 4;
  int windowStart = 0;     // minutes after midnight
  int windowEnd = 24 * 60;  // minutes after midnight
};

struct Vehicle {
  std::string id;
  double capacityKg = 0;
};

struct Problem {
  Point depot;
  int shiftStart = 7 * 60;
  int shiftEnd = 19 * 60;
  double speedKmh = 28;      // average urban speed incl. traffic
  double detourFactor = 1.3;  // road distance ≈ great-circle distance × factor
  std::vector<Vehicle> vehicles;
  std::vector<Order> orders;
  // Search budget. ALNS stops at whichever limit is hit first; both 0 = construction only.
  int timeLimitMs = 0;
  int maxIterations = 0;
  unsigned seed = 1;
};

struct Visit {
  int order;  // index into Problem::orders
  int eta;    // service start, minutes after midnight
};

struct Route {
  int vehicle = -1;
  std::vector<int> stops;  // order indices in driving sequence
  std::vector<Visit> visits;
  double distanceKm = 0;
  int returnMin = 0;
  double loadKg = 0;
};

struct TracePoint {
  int iteration;
  long ms;
  double bestKm;
  int unassigned;
};

struct OperatorStats {
  std::string name;
  double weight = 1;
  int uses = 0;
  int newBest = 0;
};

struct Solution {
  std::vector<Route> routes;
  std::vector<int> unassigned;
  double totalKm = 0;
  double initialKm = 0;  // after construction, before the search
  int improvements = 0;
  int iterations = 0;
  std::vector<TracePoint> trace;       // every new global best
  std::vector<OperatorStats> operators;
};

double haversineKm(Point a, Point b);

class Solver {
 public:
  explicit Solver(Problem p);
  Solution solve();

  // Exposed for tests.
  double travelKm(int from, int to) const;  // node 0 = depot, node i+1 = order i
  bool evaluate(Route& r) const;            // fills visits/distance; false if infeasible

 private:
  Problem p_;
  std::vector<std::vector<double>> dist_;
  int travelMin(int from, int to) const;
  double routeKm(const std::vector<int>& stops) const;
  bool twoOpt(Route& r) const;
  bool relocate(std::vector<Route>& routes) const;
  void insertUnassigned(std::vector<Route>& routes, std::vector<int>& unassigned) const;

  // ALNS (alns.cpp)
  bool feasibleWith(const Route& r, int order, size_t pos) const;
  double insertDelta(const Route& r, int order, size_t pos) const;
  bool bestInsertion(const Route& r, int order, double& delta, size_t& pos) const;
  void removeOrders(std::vector<Route>& routes, const std::vector<int>& orders) const;
  void alns(std::vector<Route>& routes, std::vector<int>& unassigned, Solution& sol) const;
};

}  // namespace tw
