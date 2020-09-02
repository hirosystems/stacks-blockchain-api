FROM everpeace/curl-jq as build

ENV ARTIFACTS "http://blockstack-stacks-blockchain_artifacts.storage.googleapis.com/index.json"

RUN curl -s "$ARTIFACTS" --output ./artifacts-resp.json \
  && cat ./artifacts-resp.json | jq -r '."stacks-node"."linux-x64".latest.url' > ./url \
  && mkdir -p /app \
  && echo "Fetching $(cat ./url)" \
  && curl --compressed $(cat ./url) --output /bin/stacks-node \
  && chmod +x /bin/stacks-node

FROM debian:stretch

COPY wait-for-it.sh /bin/wait-for-it.sh
RUN chmod +x /bin/wait-for-it.sh

COPY docker-entrypoint.sh /bin/
RUN chmod +x /bin/docker-entrypoint.sh

COPY --from=build /bin/stacks-node /bin/

ENTRYPOINT ["/bin/docker-entrypoint.sh"]
CMD ["stacks-node"]
