FROM node:13-stretch

RUN mkdir /app
COPY . /app
WORKDIR /app
RUN npm i
RUN npm run generate:types
RUN npm run build

ENV STACKS_SIDECAR_DB "memory"
ENV NODE_ENV "development"
ENV TS_NODE_SKIP_IGNORE "true"

# CMD node -r ts-node/register/transpile-only src/index.ts
CMD npm run start
