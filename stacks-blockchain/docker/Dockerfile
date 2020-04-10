FROM debian:stretch

RUN apt-get update
RUN apt-get install -y --no-install-recommends ca-certificates curl jq

ENV ARTIFACTS "https://blockstack-stacks-blockchain_artifacts.storage.googleapis.com/index.json"
RUN echo "TEST $ARTIFACTS"
RUN curl -s "$ARTIFACTS" --output ./artifacts-resp.json
RUN cat ./artifacts-resp.json | jq -r '."blockstack-core"."linux-x64".latest.url' > ./url
RUN mkdir -p /app
RUN curl --compressed $(cat ./url) --output /app/blockstack-core
RUN chmod +x /app/blockstack-core

ENV PATH "$PATH:/app"
CMD ["blockstack-core"]
