FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --only=production || npm i --only=production
COPY src ./src
EXPOSE 8080
CMD ["npm", "start"]
