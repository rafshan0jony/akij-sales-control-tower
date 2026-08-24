# Akij Sales Analytics — Node.js runtime
FROM node:22-alpine

WORKDIR /app

# Install dependencies (layer-cached)
COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# The app DB is written to ./data (mount a persistent volume for production).
CMD ["node", "server/index.js"]
