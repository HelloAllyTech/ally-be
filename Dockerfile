FROM node:18-alpine

WORKDIR /app

RUN mkdir -p /tmp/audio_storage

RUN mkdir -p /mnt/audio_storage

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

EXPOSE 8000

CMD ["npm", "run", "start:prod"]
