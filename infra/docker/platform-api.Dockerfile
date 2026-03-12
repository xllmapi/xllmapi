FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/platform-api/package.json apps/platform-api/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json

RUN npm install

COPY apps/platform-api apps/platform-api
COPY packages/shared-types packages/shared-types

RUN npm run build

FROM node:24-bookworm-slim

WORKDIR /app
ARG APT_MIRROR=mirrors.aliyun.com

RUN sed -i "s|deb.debian.org|${APT_MIRROR}|g; s|security.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
  && apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json /app/package-lock.json /app/tsconfig.base.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/platform-api/dist ./apps/platform-api/dist
COPY --from=build /app/apps/web ./apps/web
COPY --from=build /app/packages/shared-types ./packages/shared-types

EXPOSE 3000

CMD ["node", "apps/platform-api/dist/main.js"]
