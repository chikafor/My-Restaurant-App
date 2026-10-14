#!/bin/bash
# Startup script for Single-Restaurant Ordering & Delivery System

PORT=${1:-8000}
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

echo "=================================================================="
echo " Starting Artisan Flame Grill Restaurant Web Application..."
echo " Port: http://localhost:$PORT"
echo "=================================================================="

# Ensure database is initialized
python3 "$DIR/database.py"

# Start the web server
python3 "$DIR/server.py" "$PORT"
