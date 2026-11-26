
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY simulate_IP.js ./
COPY simulator.html ./
COPY sim_pack2.csv ./

ENV NODE_ENV=production

EXPOSE 8090

CMD ["node", "simulate_IP.js", "5"]
