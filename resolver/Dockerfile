FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npm run build

# The runtime stage runs as the unprivileged `node` user (uid/gid 1000) that
# node:20-alpine ships, so a compromised resolver process cannot write outside
# its own files or bind privileged ports.
FROM node:20-alpine AS runtime
WORKDIR /app
RUN corepack enable
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
# Make /app owned by the runtime user so it can create any files it needs.
RUN chown node:node /app
USER node
ENV NODE_ENV=production
ENTRYPOINT ["node", "dist/index.js"]
CMD ["run"]
