FROM node:18-alpine
WORKDIR /app
# Copy package files first so Docker cache can reuse npm install layer when deps don't change
COPY package.json package-lock.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["node", "src/index.js"]
