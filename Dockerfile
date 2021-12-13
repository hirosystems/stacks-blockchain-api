FROM node:14-alpine

WORKDIR /app

RUN apk add --no-cache --virtual .build-deps alpine-sdk python3 git openjdk8-jre cmake
COPY package.json package-lock.json ./
RUN npm config set unsafe-perm true && npm install
COPY . .
RUN echo "GIT_TAG=$(git tag --points-at HEAD)" >> .env
RUN npm run build && npm prune --production
RUN apk del .build-deps

CMD ["node", "./lib/index.js"]
