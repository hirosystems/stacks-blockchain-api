FROM debian:stretch

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl jq

ENV ARTIFACTS "http://blockstack-stacks-blockchain_artifacts.storage.googleapis.com/index.json"
RUN curl -s "$ARTIFACTS" --output ./artifacts-resp.json \
  && cat ./artifacts-resp.json | jq -r '."blockstack-core"."linux-x64".latest.url' > ./url \
  && mkdir -p /app \
  && echo "Fetching $(cat ./url)" \
  && curl --compressed $(cat ./url) --output /bin/blockstack-core \
  && chmod +x /bin/blockstack-core

COPY wait-for-it.sh /bin/wait-for-it.sh
RUN chmod +x /bin/wait-for-it.sh

CMD ["blockstack-core"]
