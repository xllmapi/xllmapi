ARG NODE_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/node:24-bookworm-slim

FROM ${NODE_IMAGE} AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/node-cli/package.json apps/node-cli/package.json
COPY apps/platform-api/package.json apps/platform-api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/logger/package.json packages/logger/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json

RUN npm ci

COPY apps/node-cli apps/node-cli
COPY apps/platform-api apps/platform-api
COPY apps/web apps/web
COPY infra/sql/postgres infra/sql/postgres
COPY packages/core packages/core
COPY packages/logger packages/logger
COPY packages/shared-types packages/shared-types

RUN npm run build
RUN npm prune --omit=dev

FROM ${NODE_IMAGE}

WORKDIR /app
ARG APT_MIRROR=mirrors.aliyun.com

RUN sed -i "s|deb.debian.org|${APT_MIRROR}|g; s|security.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
  && apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json /app/package-lock.json /app/tsconfig.base.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/node-cli/package.json ./apps/node-cli/package.json
COPY --from=build /app/apps/platform-api/dist ./apps/platform-api/dist
COPY --from=build /app/apps/platform-api/package.json ./apps/platform-api/package.json
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/packages/core ./packages/core
COPY --from=build /app/packages/logger ./packages/logger
COPY --from=build /app/packages/shared-types ./packages/shared-types
COPY --from=build /app/infra/sql/postgres ./infra/sql/postgres

EXPOSE 3000

CMD ["node", "apps/platform-api/dist/main.js"]
