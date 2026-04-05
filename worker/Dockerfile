FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY worker.js ./worker.js
COPY lib ./lib

CMD ["node", "worker.js"]
