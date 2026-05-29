FROM node:22.11-alpine

WORKDIR /app
COPY dist/ dist/
COPY package.json package-lock.json ./
RUN npm ci --production --omit=dev

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

VOLUME ["/data"]
ENV WORKBENCH_DATA_DIR=/data

CMD ["node", "dist/index.js"]
