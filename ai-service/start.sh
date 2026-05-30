#!/bin/bash
set -a
source ../.env
set +a
uvicorn main:app --port 8000
