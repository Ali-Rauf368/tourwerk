# Builds the C++ route optimizer and the C fleet simulator into native/build/.
CXX ?= g++
CC ?= gcc
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra -Wpedantic
CFLAGS ?= -std=c99 -O2 -Wall -Wextra -Wpedantic
BUILD := build

all: $(BUILD)/tw-optimizer $(BUILD)/tw-tracker

$(BUILD):
	mkdir -p $(BUILD)

$(BUILD)/tw-optimizer: optimizer/src/main.cpp optimizer/src/vrp.cpp optimizer/src/alns.cpp optimizer/src/vrp.hpp | $(BUILD)
	$(CXX) $(CXXFLAGS) -o $@ optimizer/src/main.cpp optimizer/src/vrp.cpp optimizer/src/alns.cpp

$(BUILD)/optimizer-tests: optimizer/test/vrp_test.cpp optimizer/src/vrp.cpp optimizer/src/alns.cpp optimizer/src/vrp.hpp | $(BUILD)
	$(CXX) $(CXXFLAGS) -o $@ optimizer/test/vrp_test.cpp optimizer/src/vrp.cpp optimizer/src/alns.cpp

$(BUILD)/tw-tracker: tracker/src/tracker.c | $(BUILD)
	$(CC) $(CFLAGS) -o $@ tracker/src/tracker.c -lm

test: $(BUILD)/optimizer-tests $(BUILD)/tw-tracker
	./$(BUILD)/optimizer-tests
	printf 'DEPOT 53.53 10.08\nSTOP s1 53.54 10.07 60\nGO\n' | ./$(BUILD)/tw-tracker --tick-ms 1 --speedup 3600 --fail-rate 0 | tail -1 | grep -q '^DONE'
	printf 'CLOCK 420\nDEPOT 53.53 10.08\nSTOP s1 53.54 10.07 60 480\nGO\n' | ./$(BUILD)/tw-tracker --tick-ms 1 --speedup 3600 --fail-rate 0 | grep -q '^WAIT s1'
	@echo "tracker smoke test: passed"

clean:
	rm -rf $(BUILD)

.PHONY: all test clean
