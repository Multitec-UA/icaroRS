#!/bin/bash

IMAGE_NAME="rocketserializer"
TAG="latest"

# Build the image if it doesn't exist or if --build flag is passed
if [[ "$(docker images -q ${IMAGE_NAME}:${TAG} 2> /dev/null)" == "" ]] || [[ "$1" == "--build" ]]; then
    echo "Building Docker image ${IMAGE_NAME}:${TAG}..."
    if [[ "$1" == "--build" ]]; then
        shift # Remove --build from arguments
    fi
    docker build -t ${IMAGE_NAME}:${TAG} .
fi

# Run the container
# -v $(pwd):/app: Mounts the current directory to /app
# --rm: Removes the container after exit
# -it: Interactive mode
echo "Running command in container..."
docker run --rm -it \
    -v "$(pwd)":/app \
    ${IMAGE_NAME}:${TAG} "$*"
