FROM rust:1.85-slim AS builder
WORKDIR /build
RUN apt-get update && apt-get install -y pkg-config libssl-dev libasound2-dev && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml .
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm src/main.rs
COPY src ./src
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates libasound2 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/target/release/lucid /usr/local/bin/lucid
CMD ["lucid"]
