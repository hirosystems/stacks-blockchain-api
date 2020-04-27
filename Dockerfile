FROM node:13
WORKDIR /app
COPY . .
RUN npm config set unsafe-perm true && npm install --unsafe-perm && npm run build --unsafe-perm

CMD npm run start
