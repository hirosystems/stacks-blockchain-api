FROM node:16-alpine as builder

RUN apk add --no-cache --virtual .build-deps alpine-sdk python3 git openjdk8-jre cmake

WORKDIR /app
COPY . .

RUN echo "GIT_TAG=$(git tag --points-at HEAD)" >> .env
RUN npm config set unsafe-perm true && npm ci && npm run build && npm run build:docs && npm prune --production

FROM node:16-alpine

COPY --from=builder /app /app
WORKDIR /app

CMD ["node", "./lib/index.js"]
