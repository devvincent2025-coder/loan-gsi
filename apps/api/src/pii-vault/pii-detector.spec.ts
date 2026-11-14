import { PiiDetectorService } from './pii-vault.module';

describe('PiiDetectorService', () => {
  let svc: PiiDetectorService;

  beforeEach(() => {
    svc = new PiiDetectorService();
  });

  describe('BVN / NIN detection (11-digit standalone numbers)', () => {
    it('flags an 11-digit number as BVN', () => {
      expect(svc.detectTypes('BVN: 22201234567')).toContain('BVN');
    });

    it('flags an 11-digit number as NIN', () => {
      expect(svc.detectTypes('NIN 34512345678')).toContain('NIN');
    });

    it('does not flag a 10-digit number as BVN or NIN', () => {
      const types = svc.detectTypes('ref: 1234567890');
      expect(types).not.toContain('BVN');
      expect(types).not.toContain('NIN');
    });

    it('does not flag a 12-digit number as BVN', () => {
      const types = svc.detectTypes('txn: 123456789012');
      expect(types).not.toContain('BVN');
    });
  });

  describe('Nigerian phone number detection', () => {
    it('detects local format 080xxxxxxxx', () => {
      expect(svc.detectTypes('call 08012345678')).toContain('PHONE');
    });

    it('detects local format 070xxxxxxxx', () => {
      expect(svc.detectTypes('number: 07012345678')).toContain('PHONE');
    });

    it('detects local format 090xxxxxxxx', () => {
      expect(svc.detectTypes('09012345678')).toContain('PHONE');
    });

    it('detects international +234 format', () => {
      expect(svc.detectTypes('+2348012345678')).toContain('PHONE');
    });

    it('does not flag a number starting with 01 as a phone', () => {
      const types = svc.detectTypes('01012345678');
      expect(types).not.toContain('PHONE');
    });
  });

  describe('Email detection', () => {
    it('detects a standard email address', () => {
      expect(svc.detectTypes('user@example.com')).toContain('EMAIL');
    });

    it('detects email with subdomain', () => {
      expect(svc.detectTypes('contact: info@mail.damez.ng')).toContain('EMAIL');
    });

    it('does not flag plain text as email', () => {
      expect(svc.detectTypes('hello world')).not.toContain('EMAIL');
    });
  });

  describe('NUBAN detection (10-digit account numbers)', () => {
    it('detects a 10-digit NUBAN', () => {
      expect(svc.detectTypes('account: 0123456789')).toContain('NUBAN');
    });

    it('does not flag an 11-digit number as NUBAN (standalone)', () => {
      // 11-digit number has no 10-digit word boundary within it
      const types = svc.detectTypes('22201234567');
      expect(types).not.toContain('NUBAN');
    });
  });

  describe('clean text', () => {
    it('does not flag random text without PII patterns', () => {
      expect(svc.detectTypes('Hello, welcome to Damez Loan.')).toEqual([]);
    });

    it('does not flag a short number as anything', () => {
      expect(svc.detectTypes('ref: 12345')).toEqual([]);
    });

    it('returns multiple types when multiple patterns are present', () => {
      const types = svc.detectTypes('BVN 22201234567, email: user@example.com');
      expect(types).toContain('BVN');
      expect(types).toContain('EMAIL');
    });
  });
});
