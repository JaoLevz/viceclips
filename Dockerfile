FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY public ./public

ENV NODE_ENV=production
ENV DATA_DIR=/var/data
EXPOSE 10000

CMD ["npm", "start"]
