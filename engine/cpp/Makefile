CXX ?= g++
CXXFLAGS ?= -O3 -fPIC -std=c++17 -Wall -pthread

libopenjev.so: openjev.cpp openjev.hpp
	$(CXX) $(CXXFLAGS) -shared -o libopenjev.so openjev.cpp

gold_test: libopenjev.so gold_test.cpp
	$(CXX) $(CXXFLAGS) -o gold_test gold_test.cpp -L. -lopenjev -Wl,-rpath,'$$ORIGIN'

.PHONY: clean test
clean:
	rm -f libopenjev.so gold_test

test: gold_test
	./gold_test ../gold.json
