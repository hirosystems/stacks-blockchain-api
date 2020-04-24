FROM debian:stretch

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl jq

ENV ARTIFACTS "http://blockstack-stacks-blockchain_artifacts.storage.googleapis.com/index.json"
RUN curl -s "$ARTIFACTS" --output ./artifacts-resp.json \
  && cat ./artifacts-resp.json | jq -r '."stacks-node"."linux-x64".latest.url' > ./url \
  && mkdir -p /app \
  && echo "Fetching $(cat ./url)" \
  && curl --compressed $(cat ./url) --output /bin/stacks-node \
  && chmod +x /bin/stacks-node

COPY wait-for-it.sh /bin/wait-for-it.sh
RUN chmod +x /bin/wait-for-it.sh

CMD ["stacks-node"]
