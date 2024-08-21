all: build run

build:
	docker build -t clarinet-devnet .

run:
	docker run --privileged --network host clarinet-devnet
