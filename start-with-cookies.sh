#!/bin/bash

# Create browser data directory
mkdir -p ./browser-data

# Start server with cookie persistence
echo "Starting browser with cookie persistence..."
echo "Cookies will be saved to ./browser-data/cookies.json"
echo "This stores session tokens only - NO passwords are saved!"
echo ""

# Set cookie file and start
export COOKIE_FILE=./browser-data/cookies.json
npm start