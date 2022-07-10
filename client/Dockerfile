FROM node:16.16.0-bullseye-slim 

# Create app directory
WORKDIR /app

# Install app dependencies
COPY . .

RUN npm install -qy
RUN npm run build

EXPOSE 3000
CMD [ "sh", "-c", "node server.js"]