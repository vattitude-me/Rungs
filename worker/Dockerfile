FROM node:22-alpine

WORKDIR /app

# Install deps first so a code change doesn't re-fetch them on every rebuild.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY index.js ./

# Run unprivileged: this process only needs outbound HTTPS.
USER node

CMD ["node", "index.js"]
