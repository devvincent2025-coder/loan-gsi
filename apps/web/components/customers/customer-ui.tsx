import { CheckCircle2, CircleDashed, ScanFace, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import type { CustomerDetailDto, FraudSignalDto, KycTier, KycVerificationDto } from '@damez/shared';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';

export function KycTierBadge({ tier }: { tier: KycTier }) {
  return <Badge variant={tier >= 2 ? 'success' : tier === 1 ? 'info' : 'secondary'} data-testid="kyc-tier"><ShieldCheck className="size-3" aria-hidden />{tier === 0 ? 'No KYC tier' : `Tier ${tier}`}</Badge>;
}
export function KycStatusBadge({ status }: { status: CustomerDetailDto['kycStatus'] }) {
  return <StatusBadge status={status} />;
}
const SEV: Record<FraudSignalDto['severity'], NonNullable<BadgeProps['variant']>> = { LOW: 'secondary', MEDIUM: 'warning', HIGH: 'destructive' };
export function SeverityChip({ severity }: { severity: FraudSignalDto['severity'] }) {
  return <Badge variant={SEV[severity]} data-severity={severity}>{severity.charAt(0) + severity.slice(1).toLowerCase()}</Badge>;
}
export function VerificationIcon({ status }: { status: KycVerificationDto['status'] }) {
  if (status === 'PASSED') return <CheckCircle2 className="size-4 text-success" aria-label="Passed" />;
  if (status === 'FAILED') return <XCircle className="size-4 text-destructive" aria-label="Failed" />;
  if (status === 'REVIEW') return <ShieldAlert className="size-4 text-warning" aria-label="Needs review" />;
  return <CircleDashed className="size-4 text-muted-foreground" aria-label="Pending" />;
}
export function LivenessIcon({ passed }: { passed: boolean | null }) {
  if (passed === null) return null;
  return <span className={`inline-flex items-center gap-1 text-xs ${passed ? 'text-success' : 'text-destructive'}`}><ScanFace className="size-3.5" aria-hidden />Liveness {passed ? 'passed' : 'failed'}</span>;
}
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
