#!/bin/bash

# Activate Python virtual environment
source venv/bin/activate

# Start FastAPI application
uvicorn server:app --host 0.0.0.0 --port 9001 --reload
