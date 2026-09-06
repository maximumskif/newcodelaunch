# Not build-verified in this sandbox — no Docker available here. Node
# version matches CI's pinned version (see .github/workflows/ci.yml) and
# README's setup instructions. Build and smoke-test this (`docker build .`,
# then load the page and confirm client-side routing works on a hard
# refresh of a non-root route) before relying on it for a real deploy.
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
