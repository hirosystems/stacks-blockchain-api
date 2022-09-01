FROM blockstack/stacks-blockchain:2.05.0.3.0-stretch as corenode

FROM gitpod/workspace-postgres

# Copy stacks-node binary
COPY --from=corenode /bin/stacks-node /bin/

## Stacks blockchain API env vars
ENV PG_HOST 127.0.0.1
ENV PG_PORT 5432
ENV PG_USER gitpod
ENV PG_PASSWORD postgres
ENV PG_DATABASE postgres
ENV STACKS_CORE_EVENT_PORT 3700
ENV STACKS_CORE_EVENT_HOST http://0.0.0.0
ENV STACKS_BLOCKCHAIN_API_PORT 3999
ENV STACKS_BLOCKCHAIN_API_HOST 0.0.0.0
ENV STACKS_CORE_RPC_HOST 127.0.0.1
ENV STACKS_CORE_RPC_PORT 20443
ENV NODE_ENV development

# Stacks-node env vars
ENV STACKS_EVENT_OBSERVER 127.0.0.1:3700
