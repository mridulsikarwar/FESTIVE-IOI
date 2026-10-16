#!/bin/bash
# Convenience script to start the FESTIVE IOI application
cd "$(dirname "$0")"

if [ -f "./venv/bin/python" ]; then
    PYTHON_CMD="./venv/bin/python"
else
    PYTHON_CMD="python3"
fi

echo "🚀 Starting FESTIVE IOI Cloud Application..."
$PYTHON_CMD backend/app.py
