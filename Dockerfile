FROM node:13
WORKDIR /app
COPY . .
RUN echo "GIT_TAG=$(git tag --points-at HEAD)" >> .env
RUN npm config set unsafe-perm true && npm install --unsafe-perm && npm run build --unsafe-perm

CMD npm run start
