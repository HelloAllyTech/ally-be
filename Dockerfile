FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

EXPOSE 8000

RUN chmod +x docker-entrypoint.sh

CMD ["./docker-entrypoint.sh"]