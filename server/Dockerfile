FROM node:10 

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3001
CMD [ "node", "server.js" ]