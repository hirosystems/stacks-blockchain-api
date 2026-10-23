FROM node:24-alpine

WORKDIR /app
COPY . .

RUN apk add --no-cache git
RUN npm ci --no-audit && npm run build && npm prune --production

CMD ["node", "./lib/index.js"]
