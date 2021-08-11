FROM blockstack/stacks-blockchain:2.0.11.2.0-stretch as build

FROM debian:stretch

COPY wait-for-it.sh /bin/wait-for-it.sh
RUN chmod +x /bin/wait-for-it.sh

COPY docker-entrypoint.sh /bin/
RUN chmod +x /bin/docker-entrypoint.sh

COPY --from=build /bin/stacks-node /bin/

ENTRYPOINT ["/bin/docker-entrypoint.sh"]
CMD ["stacks-node"]
