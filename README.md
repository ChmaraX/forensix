# ForensiX

## Installation

Requirements:

- docker
- docker-compose

Clone repository:

```bash
git clone https://github.com/ChmaraX/forensix.git
```

Put directory with Google Chrome artifacts to analyze into default project directory. Data folder will me mounted as a volume on server startup. The directory name must be named `/data` .

```bash
cp -r /Default/. /forensix/data
cp -r /Cache /forensix/data
```

To download prebuild images:

```bash
./install
```

To build images from local source:

```bash
./install -b
```

Wait for images to download and then start them with:

```bash
./startup
```

The runninng services are listenning on:

- ForensiX UI => http://localhost:3000
- ForensiX Server => http://localhost:3001
- MongoDB => http://localhost:27017

## HTTPS/SSL

If you want to use `HTTPS` for communication between on UI or Server side, place key and certificate into `/certificates` directory in either `/server` or `/client` directory.

To generate self-signed keys:

```bash
openssl req -nodes -new -x509 -keyout server.key -out server.cert
```

Change `baseURL` protocol to https in `/client/src/axios-api.js`,
then rebuild the specific changed image:

```bash
docker-compose build <client|server>
```
