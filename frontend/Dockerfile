FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig*.json ./
COPY vite.config.ts ./
COPY index.html ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM nginx:alpine AS runner
RUN apk add --no-cache gettext
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
# BACKEND_HOST est dérivé de BACKEND_URL (host[:port] sans schéma ni chemin) pour le
# header Host du reverse proxy — avant : "deliverytrack-api.onrender.com" en dur dans
# le template, qui cassait tout déploiement où le backend n'est pas ce service Render
# précis (ex. auto-hébergement où BACKEND_URL=http://backend:3000).
CMD export PORT="${PORT:-80}" && _h="${BACKEND_URL#*://}" && export BACKEND_HOST="${_h%%/*}" && envsubst '${BACKEND_URL} ${BACKEND_HOST} ${PORT}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'
