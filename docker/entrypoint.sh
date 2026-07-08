#!/bin/sh

# Database migrations are handled by the db-migrate init container.
# Execute the main command
exec "$@"
