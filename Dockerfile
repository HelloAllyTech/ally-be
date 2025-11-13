FROM node:18-alpine

WORKDIR /app

RUN mkdir -p /tmp/audio_storage

RUN mkdir -p /mnt/audio_storage

COPY package*.json ./

# Install build dependencies for native modules (bcrypt)
RUN apk add --no-cache python3 make g++

# Clean install - remove any existing node_modules that might have macOS binaries
RUN rm -rf node_modules package-lock.json

# Install dependencies fresh in the container
RUN npm install

# Explicitly rebuild bcrypt for Linux Alpine
RUN npm rebuild bcrypt --build-from-source

COPY . .

RUN npm run build

EXPOSE 8000

CMD ["npm", "run", "start:prod"]
