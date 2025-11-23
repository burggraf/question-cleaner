#!/bin/bash

while true; do
  echo "Starting bun command at $(date)"
  bun start --workers 10
  echo "Command exited at $(date). Waiting 30 minutes..."
  sleep 1800
done

