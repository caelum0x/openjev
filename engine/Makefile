.PHONY: all kernel server test gold clean

all: kernel server

kernel:
	$(MAKE) -C cpp libopenjev.so

server: kernel
	cd rust && cargo build --release

test: gold
	cd rust && cargo test --release || true

gold: kernel
	python3 run_gold.py

clean:
	$(MAKE) -C cpp clean
	cd rust && cargo clean
