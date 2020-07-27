FROM quay.io/blockstack/blockstack-core@sha256:348b3aebcc99b76d552ac1a59effada3bce6204f139f4ebe24c9bff1fa9356bc as corenode

FROM gitpod/workspace-postgres

# Copy stacks-node binary
COPY --from=corenode /bin/stacks-node /bin/

## Sidecar env vars
ENV PG_HOST 127.0.0.1
ENV PG_PORT 5432
ENV PG_USER gitpod
ENV PG_PASSWORD postgres
ENV PG_DATABASE postgres
ENV STACKS_SIDECAR_EVENT_PORT 3700
ENV STACKS_SIDECAR_EVENT_HOST http://0.0.0.0
ENV STACKS_SIDECAR_API_PORT 3999
ENV STACKS_SIDECAR_API_HOST 0.0.0.0
ENV STACKS_SIDECAR_DB pg
ENV STACKS_CORE_RPC_HOST 127.0.0.1
ENV STACKS_CORE_RPC_PORT 20443
ENV NODE_ENV development

# Stacks-node env vars
ENV STACKS_EVENT_OBSERVER 127.0.0.1:3700
