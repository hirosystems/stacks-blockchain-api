FROM node:13-alpine

WORKDIR /app
COPY . .

RUN apk add --no-cache --virtual .build-deps alpine-sdk python git
RUN echo "GIT_TAG=$(git tag --points-at HEAD)" >> .env
RUN npm config set unsafe-perm true && npm install --unsafe-perm && npm run build --unsafe-perm && npm prune --production
RUN apk del .build-deps

CMD npm run start
