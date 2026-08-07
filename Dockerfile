# ---- Builder Stage ----
FROM rust:slim-bookworm AS builder

RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# phoenix-rise SDK is fetched from crates.io — no longer vendored.
COPY ember-backend/ ember-backend/

WORKDIR /build/ember-backend
RUN cargo build --release

# ---- Runtime Stage ----
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/ember-backend/target/release/ember-backend /usr/local/bin/ember-backend

ENV PORT=10000
ENV RUST_LOG=ember_backend=info

EXPOSE 10000

CMD ["ember-backend"]
