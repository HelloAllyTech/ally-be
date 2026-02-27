FROM node:24-alpine

WORKDIR /app

RUN mkdir -p /tmp/audio_storage

RUN mkdir -p /mnt/audio_storage

RUN apk add --no-cache ffmpeg

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

EXPOSE 8000

CMD ["npm", "run", "start:prod"]
