# Pointed to stacks-blockchain `2.1.0.0.0` git tag
FROM --platform=linux/amd64 hirosystems/stacks-api-e2e:stacks3.0-4d11d85 as build

FROM --platform=linux/amd64 debian:bookworm

COPY wait-for-it.sh /bin/wait-for-it.sh
RUN chmod +x /bin/wait-for-it.sh

COPY docker-entrypoint.sh /bin/
RUN chmod +x /bin/docker-entrypoint.sh

COPY --from=build /usr/local/bin/stacks-node /bin/

ENTRYPOINT ["/bin/docker-entrypoint.sh"]
CMD ["stacks-node"]
