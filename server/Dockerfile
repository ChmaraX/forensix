FROM node:10 

# RUN apt-get update || : && apt-get install python -y
# RUN apt-get install python3-pip

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./

RUN npm install -qy

COPY . .

EXPOSE 3001
CMD [ "npm", "start" ]