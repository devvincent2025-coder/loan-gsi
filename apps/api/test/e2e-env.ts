// e2e runs against the dev DB/Redis from docker compose (seeded). Demo mode lets tests fetch TOTP codes.
process.env.DEMO_MODE = 'true';
process.env.AUTH_THROTTLE_LIMIT = '1000';
process.env.THROTTLE_LIMIT = '100000';
process.env.LOG_LEVEL = 'silent';
