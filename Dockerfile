FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53

WORKDIR /app
COPY . .

RUN apk add --no-cache git
RUN npm ci --no-audit && npm run build && npm prune --production

CMD ["node", "./lib/index.js"]
