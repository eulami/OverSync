FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

COPY src ./src
RUN npm run build

# The runtime stage runs as the unprivileged `node` user (uid/gid 1000) that
# node:22-alpine ships, so a compromised relayer process cannot write outside
# its own files or bind privileged ports.
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev

COPY --chown=node:node --from=builder /app/dist ./dist

# The relayer persists event history and relay submissions under /app.
RUN chown node:node /app

EXPOSE 8080

USER node

CMD ["npm", "start"]
