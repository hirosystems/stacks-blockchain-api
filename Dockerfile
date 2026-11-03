FROM node:24.22.2-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85

WORKDIR /app
COPY . .

RUN apk add --no-cache git
RUN npm ci --no-audit && npm run build && npm prune --production

CMD ["node", "./lib/index.js"]
