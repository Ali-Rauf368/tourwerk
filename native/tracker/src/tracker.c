/*
 * tw-tracker: simulates one delivery van driving a planned tour.
 *
 *   tw-tracker [--tick-ms 500] [--speedup 60] [--speed-kmh 28] [--fail-rate 0.04] [--jam-rate 0.08] [--seed N]
 *
 * stdin (sent once by the API):
 *   TOUR <tourId>
 *   DEPOT <lat> <lng>
 *   CLOCK <startMin>                             (optional; service clock at GO)
 *   STOP <stopId> <lat> <lng> <serviceSec> [windowStartMin]   (driving order, up to 256)
 *   GO
 * stdout (one event per line, flushed immediately):
 *   POS <lat> <lng> <speedKmh> <headingDeg> <nextStopIndex>
 *   ARRIVED <stopId>
 *   WAIT <stopId> <minutes>                      (early: waits for the delivery window)
 *   JAM <factor>                                 (congestion slows the next leg)
 *   DELIVERED <stopId> | FAILED <stopId> <reason>
 *   DONE <kmDriven>
 * Simulated time runs `speedup` times faster than wall-clock time.
 */
#define _POSIX_C_SOURCE 200809L
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define MAX_STOPS 256
#define DETOUR 1.3
#define PI 3.14159265358979323846

typedef struct {
  char id[64];
  double lat, lng;
  int service_sec;
  int window_start; /* minutes after midnight, -1 = none */
} Stop;

static unsigned long rng_state = 1;
static double rnd(void) {
  rng_state = rng_state * 6364136223846793005UL + 1442695040888963407UL;
  return (double)((rng_state >> 33) & 0x7fffffff) / 2147483648.0;
}

static double haversine_km(double lat1, double lng1, double lat2, double lng2) {
  const double r = PI / 180.0;
  const double dlat = (lat2 - lat1) * r, dlng = (lng2 - lng1) * r;
  const double h = sin(dlat / 2) * sin(dlat / 2) + cos(lat1 * r) * cos(lat2 * r) * sin(dlng / 2) * sin(dlng / 2);
  return 2 * 6371.0 * asin(sqrt(h));
}

static double bearing_deg(double lat1, double lng1, double lat2, double lng2) {
  const double r = PI / 180.0;
  const double y = sin((lng2 - lng1) * r) * cos(lat2 * r);
  const double x = cos(lat1 * r) * sin(lat2 * r) - sin(lat1 * r) * cos(lat2 * r) * cos((lng2 - lng1) * r);
  return fmod(atan2(y, x) / r + 360.0, 360.0);
}

static void sleep_ms(long ms) {
  if (ms <= 0) return;
  struct timespec ts = {ms / 1000, (ms % 1000) * 1000000L};
  nanosleep(&ts, NULL);
}

static const char *arg_value(int argc, char **argv, const char *name, const char *fallback) {
  for (int i = 1; i + 1 < argc; ++i)
    if (strcmp(argv[i], name) == 0) return argv[i + 1];
  return fallback;
}

int main(int argc, char **argv) {
  const long tick_ms = atol(arg_value(argc, argv, "--tick-ms", "500"));
  const double speedup = atof(arg_value(argc, argv, "--speedup", "60"));
  const double speed_kmh = atof(arg_value(argc, argv, "--speed-kmh", "28"));
  const double fail_rate = atof(arg_value(argc, argv, "--fail-rate", "0.04"));
  const double jam_rate = atof(arg_value(argc, argv, "--jam-rate", "0"));
  rng_state = (unsigned long)atol(arg_value(argc, argv, "--seed", "1")) + 1;
  if (tick_ms <= 0 || speedup <= 0 || speed_kmh <= 0) {
    fprintf(stderr, "tw-tracker: --tick-ms, --speedup and --speed-kmh must be positive\n");
    return 2;
  }

  static Stop stops[MAX_STOPS + 1]; /* stops[n] is the depot on the way back */
  int n = 0;
  double depot_lat = 0, depot_lng = 0, clock_min = 420;
  char line[256];
  while (fgets(line, sizeof line, stdin)) {
    if (strncmp(line, "GO", 2) == 0) break;
    if (strncmp(line, "DEPOT", 5) == 0) {
      sscanf(line + 5, "%lf %lf", &depot_lat, &depot_lng);
    } else if (strncmp(line, "CLOCK", 5) == 0) {
      sscanf(line + 5, "%lf", &clock_min);
    } else if (strncmp(line, "STOP", 4) == 0 && n < MAX_STOPS) {
      stops[n].window_start = -1;
      if (sscanf(line + 4, "%63s %lf %lf %d %d", stops[n].id, &stops[n].lat, &stops[n].lng, &stops[n].service_sec, &stops[n].window_start) >= 4) n++;
    }
  }
  strcpy(stops[n].id, "DEPOT");
  stops[n].lat = depot_lat;
  stops[n].lng = depot_lng;
  stops[n].service_sec = 0;

  static const char *reasons[] = {"recipient_absent", "address_not_found", "refused"};
  const double sim_sec_per_tick = tick_ms / 1000.0 * speedup;
  double lat = depot_lat, lng = depot_lng, km = 0;

  for (int target = 0; target <= n; ++target) {
    const Stop *s = &stops[target];
    /* Some legs hit congestion: the van crawls at 35-60 % of its usual speed. */
    double jam = 1.0;
    if (target < n && rnd() < jam_rate) {
      jam = 0.35 + 0.25 * rnd();
      printf("JAM %.2f\n", jam);
    }
    for (;;) {
      /* Speed varies ±30 % around the average (traffic lights, congestion). */
      const double v = speed_kmh * jam * (0.7 + 0.6 * rnd());
      const double step_km = v * sim_sec_per_tick / 3600.0 / DETOUR;
      const double remaining = haversine_km(lat, lng, s->lat, s->lng);
      const double heading = bearing_deg(lat, lng, s->lat, s->lng);
      if (remaining <= step_km) {
        km += remaining * DETOUR;
        lat = s->lat;
        lng = s->lng;
        printf("POS %.6f %.6f 0 %.0f %d\n", lat, lng, heading, target);
        fflush(stdout);
        break;
      }
      const double f = step_km / remaining;
      lat += (s->lat - lat) * f;
      lng += (s->lng - lng) * f;
      km += step_km * DETOUR;
      clock_min += sim_sec_per_tick / 60.0;
      printf("POS %.6f %.6f %.0f %.0f %d\n", lat, lng, v, heading, target);
      fflush(stdout);
      sleep_ms(tick_ms);
    }
    if (target == n) break;
    if (s->window_start >= 0 && clock_min < s->window_start) {
      const double wait = s->window_start - clock_min;
      printf("WAIT %s %.0f\n", s->id, wait);
      fflush(stdout);
      sleep_ms((long)(wait * 60.0 / speedup * 1000.0));
      clock_min = s->window_start;
    }
    printf("ARRIVED %s\n", s->id);
    fflush(stdout);
    sleep_ms((long)(s->service_sec / speedup * 1000.0));
    clock_min += s->service_sec / 60.0;
    if (rnd() < fail_rate) printf("FAILED %s %s\n", s->id, reasons[(int)(rnd() * 3) % 3]);
    else printf("DELIVERED %s\n", s->id);
    fflush(stdout);
  }
  printf("DONE %.3f\n", km);
  fflush(stdout);
  return 0;
}
