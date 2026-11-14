-- allow Prisma's shadow database (damez_shadow) for `prisma migrate dev`
GRANT ALL PRIVILEGES ON `damez%`.* TO 'damez'@'%';
FLUSH PRIVILEGES;
