# Pointed to stacks-blockchain `next` branch as of commit https://github.com/stacks-network/stacks-blockchain/commit/43b3398c428890d67392d6125b326c31913c1712
FROM --platform=linux/amd64 hirosystems/stacks-api-e2e:stacks2.1-ecb1872 as build

FROM --platform=linux/amd64 debian:bullseye

COPY wait-for-it.sh /bin/wait-for-it.sh
RUN chmod +x /bin/wait-for-it.sh

COPY docker-entrypoint.sh /bin/
RUN chmod +x /bin/docker-entrypoint.sh

COPY --from=build /usr/local/bin/stacks-node /bin/

ENTRYPOINT ["/bin/docker-entrypoint.sh"]
CMD ["stacks-node"]
