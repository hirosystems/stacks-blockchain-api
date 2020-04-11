FROM node:13-stretch

COPY package* /app/
RUN cd /app; npm install

COPY . /app
WORKDIR /app
RUN npm run generate:types
RUN npm run build

ENV STACKS_SIDECAR_DB "memory"
ENV NODE_ENV "development"
ENV TS_NODE_SKIP_IGNORE "true"

CMD npm run start
