// Adaptive Large Neighbourhood Search for the CVRPTW (see vrp.hpp for the overview).
#include <algorithm>
#include <chrono>
#include <cmath>
#include <limits>
#include <random>

#include "vrp.hpp"

namespace tw {
namespace {

// An order left out costs as much as a very long detour, so the search always prefers
// serving more orders over driving fewer kilometres.
constexpr double kUnassignedPenalty = 1000.0;
// Roulette-wheel scores (Ropke & Pisinger): new global best / better than current / accepted.
constexpr double kScoreBest = 33, kScoreBetter = 9, kScoreAccepted = 13;
constexpr double kReaction = 0.15;  // how fast weights follow recent performance
constexpr int kSegment = 80;        // iterations between weight updates
constexpr size_t kMaxTrace = 400;

double cost(const std::vector<Route>& routes, size_t unassigned) {
  double c = kUnassignedPenalty * static_cast<double>(unassigned);
  for (const auto& r : routes) c += r.distanceKm;
  return c;
}

double km(const std::vector<Route>& routes) {
  double c = 0;
  for (const auto& r : routes) c += r.distanceKm;
  return c;
}

size_t roulette(const std::vector<OperatorStats>& ops, size_t from, size_t to, std::mt19937& rng) {
  double total = 0;
  for (size_t i = from; i < to; ++i) total += ops[i].weight;
  double x = std::uniform_real_distribution<double>(0, total)(rng);
  for (size_t i = from; i < to; ++i) {
    x -= ops[i].weight;
    if (x <= 0) return i;
  }
  return to - 1;
}

}  // namespace

// Would inserting `order` at `pos` keep the route feasible? Simulates the schedule
// without copying the route, which is what makes thousands of iterations per second cheap.
bool Solver::feasibleWith(const Route& r, int order, size_t pos) const {
  if (r.loadKg + p_.orders[order].weightKg > p_.vehicles[r.vehicle].capacityKg + 1e-9) return false;
  int t = p_.shiftStart, prev = 0;
  const size_t n = r.stops.size() + 1;
  for (size_t k = 0; k < n; ++k) {
    const int cur = k == pos ? order : r.stops[k < pos ? k : k - 1];
    const Order& o = p_.orders[cur];
    t += travelMin(prev, cur + 1);
    if (t < o.windowStart) t = o.windowStart;
    if (t > o.windowEnd) return false;
    t += o.serviceMin;
    prev = cur + 1;
  }
  return t + travelMin(prev, 0) <= p_.shiftEnd;
}

double Solver::insertDelta(const Route& r, int order, size_t pos) const {
  const int a = pos == 0 ? 0 : r.stops[pos - 1] + 1;
  const int b = pos == r.stops.size() ? 0 : r.stops[pos] + 1;
  return dist_[a][order + 1] + dist_[order + 1][b] - dist_[a][b];
}

// Cheapest feasible position in one route. Distance is checked first so the
// (more expensive) schedule simulation only runs for promising positions.
bool Solver::bestInsertion(const Route& r, int order, double& delta, size_t& pos) const {
  delta = std::numeric_limits<double>::infinity();
  if (r.loadKg + p_.orders[order].weightKg > p_.vehicles[r.vehicle].capacityKg + 1e-9) return false;
  for (size_t i = 0; i <= r.stops.size(); ++i) {
    const double d = insertDelta(r, order, i);
    if (d < delta && feasibleWith(r, order, i)) {
      delta = d;
      pos = i;
    }
  }
  return std::isfinite(delta);
}

void Solver::removeOrders(std::vector<Route>& routes, const std::vector<int>& orders) const {
  std::vector<char> gone(p_.orders.size(), 0);
  for (int o : orders) gone[o] = 1;
  for (auto& r : routes) {
    const size_t before = r.stops.size();
    r.stops.erase(std::remove_if(r.stops.begin(), r.stops.end(), [&](int o) { return gone[o]; }), r.stops.end());
    if (r.stops.size() != before) evaluate(r);  // removing stops never breaks feasibility (triangle inequality)
  }
}

void Solver::alns(std::vector<Route>& routes, std::vector<int>& unassigned, Solution& sol) const {
  const int n = static_cast<int>(p_.orders.size());
  if (n < 2 || routes.empty() || (p_.timeLimitMs <= 0 && p_.maxIterations <= 0)) return;
  std::mt19937 rng(p_.seed);
  auto uni = [&](double lo, double hi) { return std::uniform_real_distribution<double>(lo, hi)(rng); };

  // Operators 0..2 destroy, 3..4 repair.
  sol.operators = {{"random", 1, 0, 0}, {"worst", 1, 0, 0}, {"related", 1, 0, 0}, {"greedy", 1, 0, 0}, {"regret2", 1, 0, 0}};
  std::vector<double> segScore(sol.operators.size(), 0);
  std::vector<int> segUses(sol.operators.size(), 0);

  // Relatedness for Shaw removal: close in space and with similar time windows.
  double maxDist = 1e-9;
  for (int i = 1; i <= n; ++i)
    for (int j = i + 1; j <= n; ++j) maxDist = std::max(maxDist, dist_[i][j]);
  auto related = [&](int a, int b) {
    const Order &x = p_.orders[a], &y = p_.orders[b];
    return dist_[a + 1][b + 1] / maxDist + (std::abs(x.windowStart - y.windowStart) + std::abs(x.windowEnd - y.windowEnd)) / 720.0;
  };

  std::vector<Route> current = routes, best = routes;
  std::vector<int> curUn = unassigned, bestUn = unassigned;
  double curCost = cost(current, curUn.size()), bestCost = curCost;

  const auto t0 = std::chrono::steady_clock::now();
  auto elapsedMs = [&] {
    return static_cast<long>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count());
  };
  sol.trace.push_back({0, 0, km(best), static_cast<int>(bestUn.size())});

  // Start hot enough to accept a 4 % worse solution half the time; cool to ~0 by the end.
  const double T0 = 0.04 * std::max(1.0, km(current)) / std::log(2.0);
  const int qMin = std::max(2, n / 12), qMax = std::max(qMin, std::min(40, n * 3 / 10));

  int it = 0;
  for (;; ++it) {
    const long ms = elapsedMs();
    double progress = 0;
    if (p_.timeLimitMs > 0) progress = std::max(progress, static_cast<double>(ms) / p_.timeLimitMs);
    if (p_.maxIterations > 0) progress = std::max(progress, static_cast<double>(it) / p_.maxIterations);
    if (progress >= 1) break;
    const double T = T0 * std::pow(0.002, progress);

    std::vector<Route> cand = current;
    std::vector<int> removed;
    const int q = std::uniform_int_distribution<int>(qMin, qMax)(rng);
    const size_t d = roulette(sol.operators, 0, 3, rng), rep = roulette(sol.operators, 3, 5, rng);

    // --- destroy ---------------------------------------------------------------
    std::vector<int> served;
    for (const auto& r : cand) served.insert(served.end(), r.stops.begin(), r.stops.end());
    const int take = std::min<int>(q, static_cast<int>(served.size()));
    if (d == 0) {  // random
      std::shuffle(served.begin(), served.end(), rng);
      removed.assign(served.begin(), served.begin() + take);
    } else if (d == 1) {  // worst: stops with the largest detour, randomised (p = 3)
      std::vector<std::pair<double, int>> detour;
      for (const auto& r : cand)
        for (size_t i = 0; i < r.stops.size(); ++i) {
          const int a = i == 0 ? 0 : r.stops[i - 1] + 1, b = i + 1 == r.stops.size() ? 0 : r.stops[i + 1] + 1, o = r.stops[i] + 1;
          detour.push_back({dist_[a][o] + dist_[o][b] - dist_[a][b], r.stops[i]});
        }
      std::sort(detour.begin(), detour.end(), std::greater<>());
      while (static_cast<int>(removed.size()) < take && !detour.empty()) {
        const size_t k = static_cast<size_t>(std::pow(uni(0, 1), 3) * static_cast<double>(detour.size()));
        removed.push_back(detour[k].second);
        detour.erase(detour.begin() + static_cast<long>(k));
      }
    } else {  // related (Shaw): grow a cluster around a random seed, randomised (p = 6)
      std::vector<int> pool = served;
      const size_t s = std::uniform_int_distribution<size_t>(0, pool.size() - 1)(rng);
      removed.push_back(pool[s]);
      pool.erase(pool.begin() + static_cast<long>(s));
      while (static_cast<int>(removed.size()) < take && !pool.empty()) {
        const int ref = removed[std::uniform_int_distribution<size_t>(0, removed.size() - 1)(rng)];
        std::sort(pool.begin(), pool.end(), [&](int a, int b) { return related(ref, a) < related(ref, b); });
        const size_t k = static_cast<size_t>(std::pow(uni(0, 1), 6) * static_cast<double>(pool.size()));
        removed.push_back(pool[k]);
        pool.erase(pool.begin() + static_cast<long>(k));
      }
    }
    removeOrders(cand, removed);

    // --- repair ----------------------------------------------------------------
    std::vector<int> pending = removed;
    pending.insert(pending.end(), curUn.begin(), curUn.end());
    std::vector<int> candUn;
    if (rep == 3) {  // greedy: random order, cheapest position anywhere
      std::shuffle(pending.begin(), pending.end(), rng);
      for (int o : pending) {
        double bestD = std::numeric_limits<double>::infinity();
        size_t bestR = 0, bestP = 0;
        for (size_t ri = 0; ri < cand.size(); ++ri) {
          double dd;
          size_t pp;
          if (bestInsertion(cand[ri], o, dd, pp) && dd < bestD) bestD = dd, bestR = ri, bestP = pp;
        }
        if (!std::isfinite(bestD)) {
          candUn.push_back(o);
          continue;
        }
        cand[bestR].stops.insert(cand[bestR].stops.begin() + static_cast<long>(bestP), o);
        evaluate(cand[bestR]);
      }
    } else {  // regret-2: insert the order we would regret most not placing now
      while (!pending.empty()) {
        double bestRegret = -1, bestD = 0;
        size_t pick = 0, pickR = 0, pickP = 0;
        bool any = false;
        for (size_t k = 0; k < pending.size(); ++k) {
          double c1 = std::numeric_limits<double>::infinity(), c2 = c1;
          size_t r1 = 0, p1 = 0;
          for (size_t ri = 0; ri < cand.size(); ++ri) {
            double dd;
            size_t pp;
            if (!bestInsertion(cand[ri], pending[k], dd, pp)) continue;
            if (dd < c1) c2 = c1, c1 = dd, r1 = ri, p1 = pp;
            else if (dd < c2) c2 = dd;
          }
          if (!std::isfinite(c1)) continue;
          const double regret = std::isfinite(c2) ? c2 - c1 : 1e9;  // only one route fits: place it now
          if (!any || regret > bestRegret + 1e-9 || (std::fabs(regret - bestRegret) <= 1e-9 && c1 < bestD)) {
            any = true, bestRegret = regret, bestD = c1, pick = k, pickR = r1, pickP = p1;
          }
        }
        if (!any) {
          candUn.insert(candUn.end(), pending.begin(), pending.end());
          break;
        }
        cand[pickR].stops.insert(cand[pickR].stops.begin() + static_cast<long>(pickP), pending[pick]);
        evaluate(cand[pickR]);
        pending.erase(pending.begin() + static_cast<long>(pick));
      }
    }

    // --- accept (simulated annealing) and score the operators --------------------
    const double c = cost(cand, candUn.size());
    double score = 0;
    if (c < bestCost - 1e-6) {
      for (auto& r : cand) twoOpt(r);  // intensify around new bests only
      const double polished = cost(cand, candUn.size());
      best = cand, bestUn = candUn, bestCost = polished;
      current = cand, curUn = candUn, curCost = polished;
      score = kScoreBest;
      ++sol.operators[d].newBest, ++sol.operators[rep].newBest;
      if (sol.trace.size() < kMaxTrace) sol.trace.push_back({it + 1, elapsedMs(), km(best), static_cast<int>(bestUn.size())});
    } else if (c < curCost - 1e-6) {
      current = std::move(cand), curUn = std::move(candUn), curCost = c;
      score = kScoreBetter;
    } else if (uni(0, 1) < std::exp(-(c - curCost) / std::max(T, 1e-9))) {
      current = std::move(cand), curUn = std::move(candUn), curCost = c;
      score = kScoreAccepted;
    }
    for (size_t o : {d, rep}) {
      ++sol.operators[o].uses;
      ++segUses[o];
      segScore[o] += score;
    }
    if ((it + 1) % kSegment == 0) {
      for (size_t o = 0; o < sol.operators.size(); ++o) {
        if (segUses[o]) sol.operators[o].weight = std::max(0.05, (1 - kReaction) * sol.operators[o].weight + kReaction * segScore[o] / segUses[o] / kScoreBest * 3);
        segScore[o] = 0, segUses[o] = 0;
      }
    }
  }
  sol.iterations = it;
  sol.improvements += static_cast<int>(sol.trace.size()) - 1;
  routes = std::move(best);
  unassigned = std::move(bestUn);
}

}  // namespace tw
