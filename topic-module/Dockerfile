
# Build the module, then run the compiled start script.
FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY package.json ./
RUN pnpm install --prod=false
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build
EXPOSE 3001
CMD ["node", "dist/index.js"]
