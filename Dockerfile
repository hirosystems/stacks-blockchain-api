FROM node:13-stretch

COPY package* /app/
RUN cd /app; npm install

COPY . /app
WORKDIR /app
RUN npm run generate:types
RUN npm run generate:schemas
RUN npm run build

CMD npm run start
