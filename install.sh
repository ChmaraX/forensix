#!/bin/bash
if [ "$1" == "-b" ] 
then
    docker-compose build --no-cache 
else 
    docker-compose pull
fi

echo "All images have been successfully built."
