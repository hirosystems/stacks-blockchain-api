FROM node:14-alpine

WORKDIR /app
COPY . .

RUN apk add --no-cache --virtual .build-deps alpine-sdk python git openjdk8-jre
RUN echo "GIT_TAG=$(git tag --points-at HEAD)" >> .env
RUN npm config set unsafe-perm true && npm install && npm run build && npm prune --production
RUN apk del .build-deps

CMD npm run start
