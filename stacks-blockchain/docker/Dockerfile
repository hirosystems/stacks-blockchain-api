# Pointed to stacks-blockchain `next` branch as of commit https://github.com/stacks-network/stacks-blockchain/commit/43b3398c428890d67392d6125b326c31913c1712
FROM --platform=linux/amd64 blockstack/stacks-blockchain:next-43b3398-stretch as build

FROM --platform=linux/amd64 debian:stretch

COPY wait-for-it.sh /bin/wait-for-it.sh
RUN chmod +x /bin/wait-for-it.sh

COPY docker-entrypoint.sh /bin/
RUN chmod +x /bin/docker-entrypoint.sh

COPY --from=build /bin/stacks-node /bin/

ENTRYPOINT ["/bin/docker-entrypoint.sh"]
CMD ["stacks-node"]
