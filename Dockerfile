FROM node:18-alpine

WORKDIR /app

RUN mkdir -p /tmp/audio_storage

COPY package*.json ./

RUN npm install --legacy-peer-deps

COPY . .

RUN npm run build

EXPOSE 8000

CMD ["npm", "run", "start:prod"]
