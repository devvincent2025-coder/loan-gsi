// Print the current demo TOTP code: npm run totp -w @damez/api
import { authenticator } from 'otplib';
const secret = process.env.DEMO_TOTP_SECRET ?? 'JBSWY3DPEHPK3PXP';
console.log(authenticator.generate(secret), `(${authenticator.timeRemaining()}s left)`);
